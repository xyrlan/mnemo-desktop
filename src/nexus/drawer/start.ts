import type { StoreApi } from 'zustand/vanilla'
import { activeAgent, type Agent } from '../../agent/active'
import { sessionCommand } from '../../agent/command'
import { binaryOf, type AgentKind } from '../../agent/kind'
import type { PaneRuns } from '../../chrome/running'
import type { Pane } from '../../layout/store'
import { onAccount } from '../../mission/account'
import type { PaneId } from '../../layout/tree'
import { basename } from '../../path/path'
import type { DrawerTab, NexusState } from '../store'
import type { SessionSpec } from './open'
import type { Drawer } from './sessions'

/** The sessions the Nexus starts (spec `2026-10-15-nexus-app-design.md`, Q1, Q4): each a terminal
 *  in a pane with no view on screen (`openOffscreen` in the layout store, which stays the app's
 *  session registry), shown in a drawer tab. */

/** What of the layout store the sessions use. */
export type SessionLayout = StoreApi<{
  panes: Record<PaneId, Pane>
  openOffscreen(cwd: string | undefined, cmd?: string, sessionId?: string, agent?: Agent): Promise<PaneId>
  closePane(id?: PaneId): Promise<void>
  setSessionId(id: PaneId, sessionId: string | undefined): void
  typedAt(id: PaneId): number | undefined
}>

export type StartDeps = {
  layout: SessionLayout
  drawer: Drawer
  nexus: StoreApi<NexusState>
  /** Settings' permission toggle, as the workbench's *Launch agent* reads it. */
  skipPermissions(): boolean
  /** A new session id: a UUID (`claude --session-id`, `grok -s`). */
  newId(): string
  /** The active account's CLI and home, which a new session starts on (`activeAgent` when not
   *  given). */
  agent?(): Agent
  /** What runs in pane `pane` now (`paneRuns`); never rejects. */
  runs(pane: PaneId): Promise<PaneRuns>
  now(): number
}

/** How long after a command was given to a pane (`typedAt`: the restore's `claude --resume`, a
 *  session started here) a Claude it starts may not be seen running: the shell types it once its
 *  prompt is up, and `claude agents` lists a session once it has started. A pane nothing was typed
 *  into has nothing coming up (#460). */
export const RESUME_WINDOW_MS = 15_000

/** How long a pane no tab shows, a command typed into it, is left to the captain its Claude will
 *  have while a program has its terminal that `claude agents` does not list yet: a resume slow to
 *  start, as after a reboot that resumes every pane at once. Past it the pane gets a tab of its
 *  own, since what runs there may be waiting on the person (#460). */
export const STARTING_MAX_MS = 120_000

export type Sessions = {
  /** Rejects with what could not be done: every caller says it, where it was asked from. */
  openSession(spec: SessionSpec): Promise<void>
  /** The live terminal pane holding Claude session `sessionId`, unless it was found running none
   *  (`observe`); null with none. */
  paneOf(sessionId: string): PaneId | null
  endSession(pane: PaneId): Promise<void>
  /** No drawer tab shows pane `pane` any more (`Release.letGo`): it ends unless a Claude runs in
   *  it, whose captain opens it again. A shell or a saved command, ended or not, has nothing on the
   *  ship to come back from. Offscreen or kept from the workbench's tabs alike: nothing else shows
   *  either. A pane kept because its Claude runs, may be coming up, or something runs there that
   *  nobody can say what (`claude agents` failing, `claude` missing), ends once nothing does
   *  (`observe`) or its Claude session goes (`lost`). A shell at its prompt runs no Claude,
   *  whatever `claude agents` says: it ends (#460). */
  letGo(pane: PaneId): Promise<void>
  /** Pane `pane` was found running `runs` (`check` in `./launch` asks every pane that holds a
   *  Claude session id, or that no tab shows, at each session poll). One running a Claude is its
   *  session's pane from then on (`isLive`). One whose shell is at its prompt, with nothing coming
   *  up (`mayBeStarting`), runs no Claude: while it holds the same id it is not that session's
   *  pane, for a captain or a tab (`isIdle`). The id stays, so a later launch can still resume it.
   *  A pane a tab let go ends here once nothing may run in it: true when it did. */
  observe(pane: PaneId, runs: PaneRuns): Promise<boolean>
  /** Pane `pane` was found running a Claude while holding `sessionId`: tabs follow it there. */
  isLive(pane: PaneId, sessionId: string): boolean
  /** Pane `pane` was found running nothing while holding `sessionId`, and runs no Claude since. */
  isIdle(pane: PaneId, sessionId: string): boolean
  /** A Claude may still be coming up in pane `pane`: a command was given to it less than
   *  `within` (`RESUME_WINDOW_MS`) ago (`typedAt`). */
  mayBeStarting(pane: PaneId, within?: number): boolean
  /** A drawer tab let pane `pane` go, and it was kept while something may run in it. */
  isReleased(pane: PaneId): boolean
  /** Pane `pane`'s Claude session went (its id cleared). One a drawer tab let go while its Claude
   *  ran, that no tab shows now, ends, as `letGo` would have ended it then: true when it did. */
  lost(pane: PaneId): Promise<boolean>
}

/** What a tab of `spec` is called before the ship knows it: what it runs (a session on `kind`'s
 *  CLI), and where. */
export function labelFor(spec: SessionSpec, kind: AgentKind = 'claude'): string {
  if (spec.kind === 'command') return spec.label
  return `${spec.kind === 'claude' ? binaryOf(kind) : 'shell'} · ${basename(spec.root) || spec.root}`
}

/** Whether two agents are one account's. */
const sameAgent = (a: Agent, b: Agent) => a.kind === b.kind && a.config_dir === b.config_dir

/** What a session tab on terminal `p` is called: the terminal's title, else a shell in its folder. */
export function shellLabel(p: Pick<Pane, 'title' | 'cwd'> | undefined): string {
  return p?.title || (p?.cwd ? `shell · ${basename(p.cwd) || p.cwd}` : 'shell')
}

const tabKey = (pane: PaneId) => `pane:${pane}`
const why = (e: unknown) => (e instanceof Error ? e.message : String(e))
const failed = (what: string, e: unknown) => new Error(`${what}: ${why(e)}`)

export function createSessions(d: StartDeps): Sessions {
  const panes = () => d.layout.getState().panes
  /** Panes found running nothing, by the session id they held then. */
  const idle = new Map<PaneId, string>()
  /** Panes found running a Claude, by the session id they held then. */
  const live = new Map<PaneId, string>()
  /** Panes a drawer tab let go while something may have run in them. */
  const released = new Set<PaneId>()
  const isIdle = (pane: PaneId, sessionId: string) => idle.get(pane) === sessionId
  const shown = (pane: PaneId) => d.nexus.getState().tabs.some((t) => t.key === tabKey(pane))
  const alive = (p: Pane) => p.view === 'terminal' && p.id > 0 && p.exitCode === undefined && !p.error

  function paneOf(sessionId: string): PaneId | null {
    if (!sessionId) return null
    return Object.values(panes()).find((p) => alive(p) && p.sessionId === sessionId && !isIdle(p.id, sessionId))?.id ?? null
  }

  function mayBeStarting(pane: PaneId, within = RESUME_WINDOW_MS): boolean {
    const at = d.layout.getState().typedAt(pane)
    return at !== undefined && d.now() - at < within
  }

  /** What `runs` says of pane `pane`, kept by the session id it holds. */
  function mark(pane: PaneId, runs: PaneRuns) {
    const id = panes()[pane]?.sessionId
    if (runs === 'claude') {
      idle.delete(pane)
      if (id) live.set(pane, id)
    } else if (runs === 'idle' && !mayBeStarting(pane)) {
      live.delete(pane)
      if (id) idle.set(pane, id)
    }
  }

  /** Shows pane `pane` in the drawer under `tab`. */
  function show(tab: DrawerTab, pane: PaneId) {
    d.drawer.open(tab, { pane })
  }

  return {
    paneOf,

    async openSession(spec) {
      if (spec.kind === 'claude') {
        const active = (d.agent ?? activeAgent)()
        // The session's own account, so it resumes on its own CLI and home whatever is active now
        // (decision 6): the row's (`spec.agent`), else the Grok one a pane of the app ran it on
        // (`Pane.agent`), else the active one. A Claude row's resumes on the active account while
        // that is a Claude one, as it always did: switching Claude accounts moves its sessions
        // (decision 7).
        const row = spec.resume && spec.agent && (spec.agent.kind === 'grok' || spec.agent.kind !== active.kind) ? spec.agent : undefined
        const own = row || (spec.resume && Object.values(panes()).find((p) => p.sessionId === spec.resume && p.agent)?.agent) || active
        const label = labelFor(spec, own.kind)
        const id = spec.resume ?? d.newId()
        const tab: DrawerTab = { id, kind: 'captain', key: null, readOnly: null, label, sessionId: id, cwd: spec.root }
        if (spec.resume) {
          // A session one of the app's panes runs already is shown, never started a second time:
          // nor one that may be coming up there (a resume typed less than `RESUME_WINDOW_MS` ago,
          // or one still starting after that: the shell runs it), nor one where something runs
          // that nobody can say what (#460). Only when every pane holding its id is at its prompt
          // (its Claude ended while the app was closed, its resume never started) does the session
          // resume, in a new pane, which alone holds the id from then on.
          const holders = Object.values(panes()).filter((p) => alive(p) && p.sessionId === spec.resume)
          const runs = await Promise.all(holders.map((p) => d.runs(p.id)))
          holders.forEach((p, i) => mark(p.id, runs[i]))
          const busy = holders.filter((p, i) => runs[i] !== 'idle' || mayBeStarting(p.id))
          const running = busy.find((p) => runs[holders.indexOf(p)] === 'claude') ?? busy[0]
          if (running) return show(tab, running.id)
          for (const p of Object.values(panes())) if (p.sessionId === spec.resume) d.layout.getState().setSessionId(p.id, undefined)
        }
        // *Launch agent*'s words on the session's CLI: skipping its permission prompts unless
        // Settings say not to; then the session to resume, or the id to start under, so its tab is
        // its captain's from the first moment.
        const words = sessionCommand(own.kind, { skipPermissions: d.skipPermissions(), ...(spec.resume ? { resume: spec.resume } : { sessionId: id }) })
        const cmd = sameAgent(own, active) ? words : onAccount(words, { account_env: own })
        let pane: PaneId
        try {
          // A Grok session's pane keeps its account, for the restore to resume it there.
          pane = await d.layout.getState().openOffscreen(spec.root, cmd, id, own.kind === 'grok' ? own : undefined)
        } catch (e) {
          throw failed(`Could not start ${binaryOf(own.kind)} in ${spec.root}`, e)
        }
        return show(tab, pane)
      }
      const label = labelFor(spec)
      let pane: PaneId
      try {
        pane = await d.layout.getState().openOffscreen(spec.root, spec.kind === 'command' ? spec.command : undefined)
      } catch (e) {
        throw failed(`Could not open a terminal in ${spec.root}`, e)
      }
      show({ id: `session:${pane}`, kind: 'session', key: null, readOnly: null, label, sessionId: null, cwd: spec.root }, pane)
    },

    async endSession(pane) {
      await d.layout.getState().closePane(pane)
      // The host drops a closed pane's session, and its tabs with it; these go here too.
      for (const t of d.nexus.getState().tabs) if (t.key === tabKey(pane)) await d.drawer.close(t.id)
    },

    async letGo(pane) {
      const p = panes()[pane]
      if (!p || p.view !== 'terminal') return
      if (p.exitCode === undefined && !p.error) {
        const runs = await d.runs(pane)
        mark(pane, runs)
        // A Claude runs there, may be coming up, or what runs cannot be told: it is kept, since a
        // session is never ended on a guess. A shell at its prompt, or another program, ends.
        if (runs === 'claude' || runs === 'unknown' || (runs === 'other' && mayBeStarting(pane))) return void released.add(pane)
      }
      // Shown again meanwhile: it stays.
      if (shown(pane)) return
      await d.layout.getState().closePane(pane)
    },

    async observe(pane, runs) {
      if (!panes()[pane]) return false
      mark(pane, runs)
      if (!released.has(pane) || shown(pane) || runs === 'claude' || runs === 'unknown' || mayBeStarting(pane)) return false
      released.delete(pane)
      await d.layout.getState().closePane(pane)
      return true
    },
    isLive: (pane, sessionId) => live.get(pane) === sessionId,
    isIdle,
    mayBeStarting,
    isReleased: (pane) => released.has(pane),

    async lost(pane) {
      if (!released.has(pane) || shown(pane) || !panes()[pane]) return false
      released.delete(pane)
      await d.layout.getState().closePane(pane)
      return true
    },
  }
}

/** What `followPanes` asks of the sessions (`Sessions.isLive`, `Sessions.isIdle`). */
export type Seen = Pick<Sessions, 'isLive' | 'isIdle'>

/** Tab ids follow the Claude session their pane was found running (`Pane.sessionId`, which the
 *  session poll keeps current, once `Sessions.observe` saw a Claude there: `isLive`): a shell where
 *  `claude` was typed, a `claude --resume` that took another id, a `/clear`. The tab becomes that
 *  session's captain's. An id the pane holds but was never seen running there (restored from the
 *  last run, kept over a shell whose Claude ended) is not followed; and a captain's tab on a pane
 *  found running nothing under its id (`isIdle`) becomes a shell's again, on every launch (#460). A
 *  robot's tab is its child's, whatever its pane runs. */
export function followPanes(nexus: StoreApi<NexusState>, panes: Record<PaneId, Pick<Pane, 'sessionId' | 'title' | 'cwd'>>, seen: Seen): void {
  for (const t of nexus.getState().tabs) {
    if (t.kind === 'robot' || !t.key?.startsWith('pane:')) continue
    const pane = Number(t.key.slice(5))
    const sessionId = panes[pane]?.sessionId
    if (t.kind === 'captain' && sessionId === t.id && seen.isIdle(pane, sessionId)) {
      nexus.getState().retargetTab(t.id, { ...t, id: `session:${pane}`, kind: 'session', sessionId: null, label: shellLabel(panes[pane]) })
      continue
    }
    if (!sessionId || sessionId === t.id || !seen.isLive(pane, sessionId)) continue
    nexus.getState().retargetTab(t.id, { ...t, id: sessionId, kind: 'captain', sessionId })
  }
}
