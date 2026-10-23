/** `ParentsApi` over what it needs of the app (`ParentDeps`, wired in `./live`): the drawer that
 *  opens a session, the keys typed into its terminal, the mission poll's `claude agents` rows and
 *  the session's transcript. Tests hand in fakes. */

import type { Agent } from '../../agent/active'
import { binaryOf } from '../../agent/kind'
import { parseRecord } from '../../conversation/parse'
import type { FollowEvent, FollowSource, TranscriptRecord } from '../../conversation/types'
import type { SessionSpec } from '../../nexus/drawer/open'
import { handoff } from './handoff'
import { readTurn, STARTING, step, type Row, type Track } from './follow'
import type { Host, ParentEvent, ParentRef, ParentsApi, ParentStatus } from './index'

export type ParentDeps = {
  /** *New session*'s path (`nexus/drawer/open.ts`): the session in a drawer tab. */
  openSession(spec: Extract<SessionSpec, { kind: 'claude' }>): Promise<void>
  /** The live terminal pane running session `sessionId`, null with none. */
  paneOf(sessionId: string): number | null
  /** Ends the session in pane `pane`: its terminal and its tab go. */
  endSession(pane: number): Promise<void>
  /** Whether an agent CLI runs in pane `pane` now, `claude agents` listing it: its prompt is up. */
  runsAgent(pane: number): Promise<boolean>
  /** Types `text` into pane `pane`'s agent as one pasted prompt, and submits it. */
  sendPrompt(pane: number, text: string): Promise<void>
  /** Answers the permission prompt pane `pane`'s agent shows. */
  answerApproval(pane: number, allow: boolean): Promise<void>
  /** The account a session on `host` runs on: the active one when it is that host's, else one of
   *  that host's; null when there is none. */
  agentFor(host: Host): Agent | null
  /** The config's `host` (`jarvis.json`), null when it names none. */
  defaultHost(): Promise<Host | null>
  /** Every `claude agents` row the mission snapshot holds, and when it was read (ms, null when
   *  unknown). */
  rows(): { rows: (Row & { session_id: string })[]; at: number | null }
  onRows(cb: () => void): () => void
  /** Whether pane `pane` is still a live terminal. */
  paneAlive(pane: number): boolean
  onPanes(cb: () => void): () => void
  /** Streams session `sessionId`'s transcript (`conversation_follow`) until the returned function
   *  is called. */
  follow(sessionId: string, cwd: string, onEvent: (e: FollowEvent) => void, source?: FollowSource): Promise<() => void>
  newId(): string
  now(): number
  sleep(ms: number): Promise<void>
}

/** How long a parent's prompt has to come up before Jarvis gives up typing into it. A first
 *  `claude` on a cold machine takes several seconds, and `claude agents` lists it only after. */
export const PROMPT_UP_MS = 90_000
/** How often the pane is asked meanwhile. */
export const PROMPT_POLL_MS = 500
/** How long the TUI is given to draw its input once `claude agents` lists it. */
export const SETTLE_MS = 1_500

type Entry = {
  ref: ParentRef
  track: Track
  /** The transcript since the last prompt. */
  records: TranscriptRecord[]
  /** The pane it was last found in. */
  pane: number | null
  /** Its row was in a snapshot once: a later one without it may mean it exited. */
  listed: boolean
  unfollow: (() => void) | null
}

const why = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** `load` resolves the app's deps the first time they are needed, so importing the API costs
 *  nothing until a parent opens. */
export function makeParents(load: () => Promise<ParentDeps>): ParentsApi {
  const entries = new Map<string, Entry>()
  const subscribers = new Set<(e: ParentEvent) => void>()
  let wired: Promise<ParentDeps> | null = null

  const emit = (e: ParentEvent) => {
    for (const cb of subscribers) {
      try {
        cb(e)
      } catch (err) {
        console.error('jarvis: a parent subscriber threw', err)
      }
    }
  }

  /** The deps, with the rows and panes followed from the first call on. */
  const deps = () =>
    (wired ??= load().then((d) => {
      d.onRows(() => void recheckAll(d))
      d.onPanes(() => void recheckAll(d))
      return d
    }))

  function finish(entry: Entry) {
    entry.unfollow?.()
    entry.unfollow = null
  }

  /** Reads the parent again and says what moved. */
  function recheck(d: ParentDeps, entry: Entry, exited = false) {
    const { rows, at } = d.rows()
    const row = rows.find((r) => same(r.session_id, entry.ref.sessionId)) ?? null
    if (row) entry.listed = true
    const pane = d.paneOf(entry.ref.sessionId)
    if (pane !== null) entry.pane = pane
    const gone = exited || (entry.pane !== null && !d.paneAlive(entry.pane))
    const turn = readTurn(entry.records)
    // Only this turn's records are kept: nothing before the last prompt is read again.
    if (turn.start > 0) entry.records = entry.records.slice(turn.start)
    const { track, said } = step(entry.track, { row, rowAt: at, turn, exited: gone })
    entry.track = track
    // A parent the handoff never reached was never announced: nothing is said of it.
    if (track.handedOff) for (const s of said) emit({ ...s, parent: entry.ref } as ParentEvent)
    if (track.state === 'exited') finish(entry)
    // Listed once and not any more, its terminal still there: the agent may have exited to the
    // shell (`/exit`). The pane says.
    else if (entry.track.handedOff && entry.listed && !row && entry.pane !== null) {
      const p = entry.pane
      void d.runsAgent(p).then(
        (runs) => void (!runs && entry.track.state !== 'exited' && recheck(d, entry, true)),
        () => {},
      )
    }
  }

  function recheckAll(d: ParentDeps) {
    for (const e of entries.values()) if (e.track.state !== 'exited') recheck(d, e)
  }

  function known(sessionId: string): Entry {
    const e = entries.get(sessionId)
    if (!e) throw new Error(`Jarvis opened no parent ${sessionId}`)
    return e
  }

  function paneFor(d: ParentDeps, e: Entry): number {
    if (e.track.state === 'exited') throw new Error(`The parent in ${e.ref.project} has exited`)
    const pane = d.paneOf(e.ref.sessionId)
    if (pane === null) throw new Error(`The parent in ${e.ref.project} runs in no terminal of the app: nothing was sent`)
    return pane
  }

  return {
    async open(o) {
      const d = await deps()
      const host = o.host ?? (await d.defaultHost().catch(() => null)) ?? 'claude'
      const agent = d.agentFor(host)
      if (!agent) throw new Error(`There is no ${host === 'grok' ? 'Grok Build' : 'Claude Code'} account to open a parent on`)
      const sessionId = d.newId()
      const ref: ParentRef = { sessionId, project: o.project, root: o.root, request: o.request, host, startedAt: d.now() }
      // Never skipping its permission prompts, whatever Settings say (`ask`): they are the only
      // guard between a misheard sentence and a write.
      await d.openSession({ kind: 'claude', root: o.root, sessionId, agent, ask: true })
      const entry: Entry = { ref, track: STARTING, records: [], pane: null, listed: false, unfollow: null }
      entries.set(sessionId, entry)
      const source: FollowSource | undefined = host === 'grok' ? { kind: 'grok', home: agent.config_dir } : undefined
      d.follow(sessionId, o.root, (e) => onFollow(d, entry, e), source).then(
        (stop) => (entry.track.state === 'exited' ? stop() : (entry.unfollow = stop)),
        (e: unknown) => console.error(`jarvis: cannot follow parent ${sessionId}'s transcript`, e),
      )

      // Its prompt is up once `claude agents` lists it under the pane; then the TUI draws.
      const until = d.now() + PROMPT_UP_MS
      let pane: number | null = null
      while (d.now() < until && entry.track.state !== 'exited') {
        const p = d.paneOf(sessionId)
        if (p !== null && (await d.runsAgent(p).catch(() => false))) {
          pane = p
          break
        }
        await d.sleep(PROMPT_POLL_MS)
      }
      if (pane === null) {
        entries.delete(sessionId)
        finish(entry)
        if (entry.track.state === 'exited') throw new Error(`${binaryOf(host)} in ${o.project} ended before its prompt came up: nothing was typed into it`)
        throw new Error(`${binaryOf(host)} did not come up in ${o.project} within ${PROMPT_UP_MS / 1000} s: its tab stays open, and nothing was typed into it`)
      }
      await d.sleep(SETTLE_MS)
      try {
        await d.sendPrompt(pane, handoff(o.request, o.gathered))
      } catch (e) {
        entries.delete(sessionId)
        finish(entry)
        throw new Error(`Could not type the request into ${binaryOf(host)} in ${o.project}: ${why(e)}`)
      }
      entry.pane = pane
      entry.track = { ...entry.track, handedOff: true, state: 'working' }
      emit({ kind: 'opened', parent: ref })
      return ref
    },

    async send(sessionId, text) {
      const d = await deps()
      const e = known(sessionId)
      await d.sendPrompt(paneFor(d, e), text)
      e.track = { ...e.track, state: 'working', question: null }
    },

    async status(sessionId): Promise<ParentStatus> {
      const { state, summary, question } = known(sessionId).track
      return { state, summary, question }
    },

    async answer(sessionId, allow) {
      const d = await deps()
      const e = known(sessionId)
      if (e.track.state !== 'approval') throw new Error(`The parent in ${e.ref.project} is waiting on no permission prompt`)
      await d.answerApproval(paneFor(d, e), allow)
      e.track = { ...e.track, state: 'working', question: null, answeredAt: d.now() }
    },

    async cancel(sessionId) {
      const d = await deps()
      const e = known(sessionId)
      if (e.track.state === 'exited') return
      const pane = d.paneOf(sessionId) ?? e.pane
      if (pane !== null) await d.endSession(pane)
      recheck(d, e, true)
    },

    running: () =>
      [...entries.values()]
        .filter((e) => e.track.handedOff && e.track.state !== 'exited')
        .map((e) => e.ref)
        .sort((a, b) => b.startedAt - a.startedAt),

    subscribe(cb) {
      subscribers.add(cb)
      return () => void subscribers.delete(cb)
    },
  }

  function onFollow(d: ParentDeps, entry: Entry, e: FollowEvent) {
    if (e.kind === 'reset') entry.records = []
    else if (e.kind === 'lines') entry.records.push(...e.lines.flatMap((l) => parseRecord(l) ?? []))
    else return
    if (entry.track.state !== 'exited') recheck(d, entry)
  }
}

/** `claude agents` may give the first eight characters of an id only. */
const same = (a: string, b: string) => a === b || (a.length >= 8 && b.startsWith(a)) || (b.length >= 8 && a.startsWith(b))
