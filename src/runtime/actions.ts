// `Actions` for the live world (`src/world/actions.ts`): everything a view can do to the fleet,
// over the paths the app already has, with every guard those paths carry. A view names a session
// or a waiting item of the world; this finds the mission snapshot's own row for it and takes the
// path the ship took: a hidden attach for a background child (`cockpit/approve`, `mission/ask`,
// `mission/as-me`), the pane's own screen for a session in one of the app's terminals
// (`./pane-keys`), the cockpit's jobs for a merge, a land and a dispatch.
//
// Nothing here throws for something it can say: a refusal is an `Outcome` whose `why` is said to
// the maintainer as it is.

import type { Choice as PromptChoice } from '../cockpit/prompt'
import type { InsightAsk } from '../insight/types'
import { inputBox } from '../mission/as-me'
import { allChildren, type ChildSession, type Mission, type Pr, type Snapshot } from '../mission/types'
import type { SessionSpec } from '../nexus/drawer/open'
import { otherRepo } from '../nexus/command/find'
import type { Actions, DispatchOptions, Outcome } from '../world/actions'
import { sessionOf } from '../world/store'
import type { Choice, Pending, Session, World } from '../world/types'
import type { Hosting } from './hosting'
import { answerInWords, pickOption, pressPermission, sendPrompt, type PaneDeps } from './pane-keys'
import { childRow, isRunning, knownRoots, missionRow, prOf, prRow, repoRoot } from './rows'

/** How one of the app's own jobs or answers went (`Outcome` in `src/nexus/command/run.ts`). */
export type Did = { ok: boolean; why: string }

/** The app's own paths. `./live` wires the real ones; a test hands in its own. Each resolves with
 *  how it went or rejects with why. */
export type ActionPaths = {
  world(): World
  snapshot(): Snapshot
  hosting: Pick<Hosting, 'open' | 'close' | 'paneOf'>
  /** Puts a session, or a terminal the app holds, on Console's stage. */
  stage(id: string): void
  /** A child in the background, through a hidden attach on its own account or its inbox. */
  child: {
    answerQuestion(child: ChildSession, index: number): Promise<void>
    answerQuestionOther(child: ChildSession, text: string): Promise<void>
    answerPrompt(child: ChildSession, choice: PromptChoice): Promise<Did>
    /** Typed into its own terminal, so it is the maintainer's turn (`replyAsMe`). `suggested`: the
     *  child's own suggested reply, which is never sent as his. */
    asMe(child: ChildSession, text: string): Promise<void>
    /** One turn into a background session's inbox, by its short id (`mission_reply`). */
    inbox(id: string, text: string): Promise<void>
  }
  /** A session in one of the app's own terminals. */
  pane: PaneDeps
  /** The cockpit's checks-gated merge of one PR, once it has ended. */
  merge(root: string, pr: Pr): Promise<Did>
  /** `mnemo land` on a contract, as an app job, once it has ended. */
  land(root: string, mission: Mission): Promise<Did>
  dispatch(root: string, issues: number[], options: DispatchOptions): Promise<Did>
  dispatchContract(root: string, path: string, options: DispatchOptions): Promise<Did>
  /** `claude stop` on the child's own account, run from `root`. */
  stop(root: string, child: ChildSession): Promise<Did>
  /** Starts a session, a shell or a command in a terminal the app holds; the id it is held
   *  under, for the stage (null when it cannot be told). */
  openSession(spec: SessionSpec): Promise<string | null>
  /** The CLI the active account runs: `claude` or `grok`. */
  activeKind(): string
  /** One screenshot's bytes, base64 (`insight_shot`). */
  shot(ask: InsightAsk, id: string): Promise<string>
  /** Opens an http(s) page in the system browser; rejects for anything else. */
  page(url: string): Promise<void>
  /** Opens a file or a folder with what the system opens it with. */
  file(path: string): Promise<void>
}

const ok = (note?: string): Outcome => (note ? { ok: true, note } : { ok: true })
const no = (why: string): Outcome => ({ ok: false, why })
const said = (e: unknown) => (e instanceof Error ? e.message : String(e))
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export const NOT_WAITING = 'That is no longer waiting.'
export const GONE = 'That session is not here any more.'
export const NOTHING = 'Nothing to send.'
const OUT_OF_REACH = 'It runs outside the app and has no inbox: nothing was sent.'

/** Runs a path that rejects with why, as an outcome. */
async function tried(run: () => Promise<unknown>, note?: string): Promise<Outcome> {
  try {
    await run()
    return ok(note)
  } catch (e) {
    return no(said(e))
  }
}

const did = (d: Did, note?: string): Outcome => (d.ok ? ok(note ?? (d.why || undefined)) : no(d.why || 'That did not go through.'))

/** A permission card's choice as the prompt names it. */
function promptChoice(c: Choice): PromptChoice {
  if (c.tone === 'bad') return 'no'
  return /always|don'?t ask/i.test(c.label) ? 'always' : 'yes'
}

export function createActions(p: ActionPaths): Actions {
  const session = (id: string) => sessionOf(p.world(), id)
  const waitsOn = (s: Session, kind: Pending['kind']) => p.world().pending.find((x) => x.session === s.id && x.kind === kind)
  /** The repo a child works in, from its own folder: its parent's can be another one. */
  const rootOf = (s: Session, child?: ChildSession) => (child ? repoRoot(child.cwd, knownRoots(p.snapshot())) : (s.root ?? s.cwd))

  /** Speaks to a session in the maintainer's own words: his turn, wherever it runs. */
  async function reply(sessionId: string, text: string): Promise<Outcome> {
    const words = text.trim()
    if (!words) return no(NOTHING)
    const s = session(sessionId)
    if (!s) return no(GONE)
    if (waitsOn(s, 'permission')) return no('It asks a permission: allow or deny it first.')
    const asks = waitsOn(s, 'question')
    const pane = p.hosting.paneOf(s.id)
    if (pane !== null) return tried(() => (asks ? answerInWords(p.pane, pane, words) : sendPrompt(p.pane, pane, words)))
    const child = childRow(p.snapshot(), s)
    if (child) {
      if (asks) return tried(() => p.child.answerQuestionOther(child, words))
      if (child.live) return tried(() => p.child.asMe(child, words))
      // No process to type into: its inbox wakes it, as a peer's message.
      return tried(() => p.child.inbox(child.id, words), 'It has no terminal now: sent to its inbox.')
    }
    return no(s.live ? OUT_OF_REACH : 'It has ended: open it to resume it, then speak to it.')
  }

  async function stop(sessionId: string): Promise<Outcome> {
    const s = session(sessionId)
    if (!s) return no(GONE)
    const child = childRow(p.snapshot(), s)
    if (!child) return no('It is a session you talk to: close it to end it.')
    if (!isRunning(child)) return no('It is not running: nothing was stopped.')
    try {
      return did(await p.stop(rootOf(s, child) ?? child.cwd, child), 'Stopped. It keeps its conversation.')
    } catch (e) {
      return no(`Not stopped: ${said(e)}`)
    }
  }

  async function merge(s: Session, item: Pending): Promise<Outcome> {
    const child = childRow(p.snapshot(), s)
    const shown = item.pr ?? s.prs.find((x) => x.state === 'open') ?? null
    const pr = (child && prRow(p.snapshot(), child, shown?.number)) ?? (shown ? prOf(shown) : null)
    if (!pr) return no('It has no pull request to merge.')
    const root = rootOf(s, child)
    if (!root) return no('Its repo is not known: merge it on GitHub.')
    const elsewhere = otherRepo(root, pr)
    if (elsewhere) return no(elsewhere)
    try {
      return did(await p.merge(root, pr), `Merged #${pr.number}.`)
    } catch (e) {
      return no(said(e))
    }
  }

  return {
    open: (sessionId) => p.hosting.open(sessionId),

    async answer(pendingId, key) {
      const item = p.world().pending.find((x) => x.id === pendingId)
      const choice = item?.choices.find((c) => c.key === key)
      const s = item && session(item.session)
      if (!item || !choice || !s) return no(NOT_WAITING)
      const pane = p.hosting.paneOf(s.id)
      const child = pane === null ? childRow(p.snapshot(), s) : undefined
      switch (item.kind) {
        case 'question': {
          const index = item.choices.indexOf(choice)
          if (pane !== null) return tried(() => pickOption(p.pane, pane, index, choice.label), choice.label)
          if (child) return tried(() => p.child.answerQuestion(child, index), choice.label)
          return no('It runs outside the app: answer it in its own terminal.')
        }
        case 'permission': {
          const pick = promptChoice(choice)
          // A card that knows only what `claude agents` says (`permission prompt`) names no call.
          const about = item.detail && item.detail !== childRow(p.snapshot(), s)?.waiting_for ? item.detail : null
          if (pane !== null) return tried(() => pressPermission(p.pane, pane, pick, about), choice.label)
          if (!child) return no('It runs outside the app: answer it in its own terminal.')
          try {
            return did(await p.child.answerPrompt(child, pick), choice.label)
          } catch (e) {
            return no(said(e))
          }
        }
        case 'merge':
          return choice.tone === 'bad' ? no('Say what is missing: answer it in your words.') : merge(s, item)
        case 'stalled':
        case 'blocked':
          return choice.tone === 'bad' ? stop(s.id) : reply(s.id, 'continue')
      }
    },

    reply,
    stop,
    close: (sessionId) => p.hosting.close(sessionId),

    async newSession(root, options) {
      // A session starts on the active account's CLI (`openSession`): another one is not started
      // under its name.
      if (options?.agent && options.agent !== p.activeKind()) return no(`A new session starts on the active account, which is not a ${options.agent} one: switch accounts first.`)
      let id: string | null
      try {
        id = await p.openSession({ kind: 'claude', root })
      } catch (e) {
        return no(said(e))
      }
      if (id !== null) p.stage(id)
      const words = options?.prompt?.trim()
      // Its first prompt is typed once its input box is up, with the guards of any other turn.
      if (words && id !== null) {
        const pane = p.hosting.paneOf(id)
        if (pane === null) return ok('Started. Its terminal is not up yet: type the prompt there.')
        return tried(async () => {
          await firstBox(p.pane, pane)
          await sendPrompt(p.pane, pane, words)
        }, 'Started, and prompted.').then((o) => (o.ok ? o : ok(`Started. The prompt was not typed: ${o.why}`)))
      }
      return ok('Started.')
    },

    async newShell(root) {
      try {
        const id = await p.openSession({ kind: 'shell', root })
        if (id !== null) p.stage(id)
        return ok('A shell is open there.')
      } catch (e) {
        return no(said(e))
      }
    },

    async dispatch(root, issues, options = {}) {
      if (!issues.length) return no('No issue to dispatch.')
      const list = issues.map((n) => `#${n}`).join(' ')
      try {
        const d = await p.dispatch(root, issues, options)
        return d.ok ? ok(`Dispatched ${list}.`) : no(`${list} not dispatched: ${d.why}`)
      } catch (e) {
        return no(`${list} not dispatched: ${said(e)}`)
      }
    },

    async dispatchContract(root, path, options = {}) {
      if (!path.trim()) return no('No contract to dispatch.')
      try {
        const d = await p.dispatchContract(root, path, options)
        return d.ok ? ok(`Dispatched ${path}.`) : no(`${path} not dispatched: ${d.why}`)
      } catch (e) {
        return no(`${path} not dispatched: ${said(e)}`)
      }
    },

    async message(sessionId, text) {
      const words = text.trim()
      if (!words) return no(NOTHING)
      if (sessionId === 'all') {
        const live = allChildren(p.snapshot()).filter(isRunning)
        if (!live.length) return no('No child is running: nothing was sent.')
        const failed: string[] = []
        for (const c of live) await p.child.inbox(c.id, words).catch((e) => failed.push(`${c.id}: ${said(e)}`))
        const sent = live.length - failed.length
        if (failed.length) return no(`Sent to ${sent} of ${plural(live.length, 'child', 'children')}. Not sent: ${failed.join(' · ')}`)
        return ok(`Sent to ${plural(sent, 'child', 'children')}.`)
      }
      const s = session(sessionId)
      if (!s) return no(GONE)
      const child = childRow(p.snapshot(), s)
      if (child) return tried(() => p.child.inbox(child.id, words), 'Sent to its inbox.')
      // A session the maintainer talks to: typed into the terminal it runs in here, else its
      // inbox when it is a background session (the daemon's roster lists those).
      const pane = p.hosting.paneOf(s.id)
      if (pane !== null) return tried(() => sendPrompt(p.pane, pane, words), 'Typed into its terminal.')
      return tried(() => p.child.inbox(s.short, words), 'Sent to its inbox.').then((o) => (o.ok ? o : no(OUT_OF_REACH)))
    },

    async mergeGreen() {
      const green = p.world().pending.filter((x) => x.kind === 'merge' && x.pr?.ci === 'green' && x.pr.state !== 'merged' && x.pr.state !== 'closed' && x.pr.draft !== true)
      if (!green.length) return no('Nothing is green and open: nothing was merged.')
      const merged: string[] = []
      const not: string[] = []
      // One at a time: a merge reads the checks at the moment it runs.
      for (const item of green) {
        const s = session(item.session)
        const o = s ? await merge(s, item) : no(GONE)
        if (o.ok) merged.push(`#${item.pr!.number}`)
        else not.push(`#${item.pr!.number}: ${o.why}`)
      }
      if (not.length) return no([merged.length ? `Merged ${merged.join(', ')}.` : '', `Not merged: ${not.join(' · ')}`].filter(Boolean).join(' '))
      return ok(`Merged ${merged.join(', ')}.`)
    },

    async land(root, feature) {
      const snap = p.snapshot()
      const mission = missionRow(snap, root, feature)
      if (!mission) return no(`${feature} is not a mission of that repo: nothing was run.`)
      if (!mission.landable) return no(`${feature} is not landable now: nothing was run.`)
      // Where its pieces' children work; every piece's PR must be there.
      const at = mission.pieces.flatMap((piece) => (piece.child ? [repoRoot(piece.child.cwd, knownRoots(snap))] : []))[0] ?? root
      const elsewhere = mission.pieces.map((piece) => (piece.pr ? otherRepo(at, piece.pr) : null)).find(Boolean)
      if (elsewhere) return no(`${feature} did not land: ${elsewhere}`)
      try {
        const d = await p.land(at, mission)
        return d.ok ? ok(`${feature} landed.`) : no(`${feature} did not land: ${d.why}`)
      } catch (e) {
        return no(`${feature} did not land: ${said(e)}`)
      }
    },

    async shot(sessionId, shotId) {
      const s = session(sessionId)
      const shot = s?.web.shots.find((x) => x.id === shotId)
      if (!s || !shot) return null
      try {
        const bytes = await p.shot({ key: s.id, sessionId: s.id, cwd: s.cwd ?? '', account: s.account }, shotId)
        return bytes ? `data:${shot.mediaType || 'image/png'};base64,${bytes}` : null
      } catch {
        return null
      }
    },

    async external(target) {
      const t = target.trim()
      if (!t) return no('Nothing to open.')
      if (/^https?:\/\//i.test(t)) return tried(() => p.page(t))
      if (/^[a-z][a-z0-9+.-]+:\/\//i.test(t)) return no('Only a web page or a file opens from here.')
      return tried(() => p.file(t))
    },
  }
}

/** How long a session just started gets to draw its input box, and how often it is looked for. */
export const FIRST_BOX_MS = 30_000
const FIRST_BOX_POLL_MS = 500

/** Waits for a fresh session's terminal to run its agent: `sendPrompt` then reads its screen. */
async function firstBox(d: PaneDeps, pane: number): Promise<void> {
  for (let waited = 0; waited < FIRST_BOX_MS; waited += FIRST_BOX_POLL_MS) {
    if (await d.runsClaude(pane).catch(() => false)) {
      const lines = await d.screen(pane)
      if (lines && inputBox(lines)) return
    }
    await d.sleep(FIRST_BOX_POLL_MS)
  }
  throw new Error('its input box did not show in time')
}
