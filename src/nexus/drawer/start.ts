import type { StoreApi } from 'zustand/vanilla'
import type { Pane } from '../../layout/store'
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
  openOffscreen(cwd: string | undefined, cmd?: string, sessionId?: string): Promise<PaneId>
  closePane(id?: PaneId): Promise<void>
  setSessionId(id: PaneId, sessionId: string | undefined): void
}>

export type StartDeps = {
  layout: SessionLayout
  drawer: Drawer
  nexus: StoreApi<NexusState>
  /** Settings' permission toggle, as the workbench's *Launch agent* reads it. */
  skipPermissions(): boolean
  /** A new Claude session id: a UUID (`claude --session-id`). */
  newId(): string
  /** Whether a Claude runs under pane `pane`'s shell now; rejects when that cannot be told. */
  runsClaude(pane: PaneId): Promise<boolean>
  /** When the restore brought the saved panes back; null before it has. */
  restoredAt(): number | null
  now(): number
}

/** How long after a Claude was started in a pane (the restore's `claude --resume`, typed once the
 *  new shell's prompt is up, or a session started here) it may not show as running yet: `claude
 *  agents` lists a session once it has started. */
export const RESUME_WINDOW_MS = 15_000

export type Sessions = {
  /** Rejects with what could not be done: every caller says it, where it was asked from. */
  openSession(spec: SessionSpec): Promise<void>
  /** The live terminal pane holding Claude session `sessionId`, unless it was found running none
   *  (`markIdle`); null with none. */
  paneOf(sessionId: string): PaneId | null
  endSession(pane: PaneId): Promise<void>
  /** No drawer tab shows pane `pane` any more (`Release.letGo`): it ends unless a Claude runs in
   *  it, whose captain opens it again. A shell or a saved command, ended or not, has nothing on the
   *  ship to come back from. Offscreen or kept from the workbench's tabs alike: nothing else shows
   *  either. A pane kept because its Claude runs (or that cannot be told) ends once that Claude
   *  does (`lost`). */
  letGo(pane: PaneId): Promise<void>
  /** Pane `pane` holds Claude session `sessionId`, but was found running no Claude: it is not that
   *  session's pane, for a captain or a tab (`followPanes`), while it holds that id. The id stays,
   *  so the next launch can still resume it. */
  markIdle(pane: PaneId, sessionId: string): void
  isIdle(pane: PaneId, sessionId: string): boolean
  /** Pane `pane`'s Claude session went (its id cleared). One a drawer tab let go while its Claude
   *  ran, that no tab shows now, ends, as `letGo` would have ended it then: true when it did. */
  lost(pane: PaneId): Promise<boolean>
}

/** What *Launch agent* types (`agentCommand` in the workbench): `claude`, skipping its permission
 *  prompts unless Settings say not to; then the session to resume, or the id to start under, so
 *  its tab is its captain's from the first moment. */
export function claudeCommand(skipPermissions: boolean, how: { resume: string } | { sessionId: string }): string {
  const claude = skipPermissions ? 'claude --dangerously-skip-permissions' : 'claude'
  return 'resume' in how ? `${claude} --resume ${how.resume}` : `${claude} --session-id ${how.sessionId}`
}

/** What a tab of `spec` is called before the ship knows it: what it runs, and where. */
export function labelFor(spec: SessionSpec): string {
  if (spec.kind === 'command') return spec.label
  return `${spec.kind === 'claude' ? 'claude' : 'shell'} · ${basename(spec.root) || spec.root}`
}

const tabKey = (pane: PaneId) => `pane:${pane}`
const why = (e: unknown) => (e instanceof Error ? e.message : String(e))
const failed = (what: string, e: unknown) => new Error(`${what}: ${why(e)}`)

export function createSessions(d: StartDeps): Sessions {
  const panes = () => d.layout.getState().panes
  /** Panes found running no Claude, by the session id they held then. */
  const idle = new Map<PaneId, string>()
  /** Panes a drawer tab let go while their Claude ran, or while that could not be told. */
  const released = new Set<PaneId>()
  /** When a Claude was last started in each pane by `openSession`. */
  const started = new Map<PaneId, number>()
  const isIdle = (pane: PaneId, sessionId: string) => idle.get(pane) === sessionId
  const shown = (pane: PaneId) => d.nexus.getState().tabs.some((t) => t.key === tabKey(pane))

  function paneOf(sessionId: string): PaneId | null {
    if (!sessionId) return null
    return (
      Object.values(panes()).find((p) => p.view === 'terminal' && p.id > 0 && p.exitCode === undefined && !p.error && p.sessionId === sessionId && !isIdle(p.id, sessionId))
        ?.id ?? null
    )
  }

  /** A Claude may still be coming up in pane `pane`: the restore, or a start here, was less than
   *  `RESUME_WINDOW_MS` ago (#460). */
  function mayBeStarting(pane: PaneId): boolean {
    const now = d.now()
    return [d.restoredAt(), started.get(pane)].some((at) => at !== null && at !== undefined && now - at < RESUME_WINDOW_MS)
  }

  /** Shows pane `pane` in the drawer under `tab`. */
  function show(tab: DrawerTab, pane: PaneId) {
    d.drawer.open(tab, { pane })
  }

  return {
    paneOf,

    async openSession(spec) {
      const label = labelFor(spec)
      if (spec.kind === 'claude') {
        // A session one of the app's panes runs already is shown, never started a second time:
        // nor one that may still be coming up there (the restore's resume, a start here, less than
        // `RESUME_WINDOW_MS` ago), nor one the app cannot tell about (#460). A pane that holds its
        // id but runs no Claude (it ended while the app was closed, or its resume never started) is
        // no such pane: the session resumes in a new one, which alone holds the id from then on.
        const held = spec.resume ? paneOf(spec.resume) : null
        const running = held !== null && (mayBeStarting(held) || (await d.runsClaude(held).catch(() => true))) ? held : null
        const id = spec.resume ?? d.newId()
        const tab: DrawerTab = { id, kind: 'captain', key: null, readOnly: null, label, sessionId: id, cwd: spec.root }
        if (running !== null) return show(tab, running)
        if (spec.resume) for (const p of Object.values(panes())) if (p.sessionId === spec.resume) d.layout.getState().setSessionId(p.id, undefined)
        const cmd = claudeCommand(d.skipPermissions(), spec.resume ? { resume: spec.resume } : { sessionId: id })
        let pane: PaneId
        try {
          pane = await d.layout.getState().openOffscreen(spec.root, cmd, id)
        } catch (e) {
          throw failed(`Could not start claude in ${spec.root}`, e)
        }
        started.set(pane, d.now())
        return show(tab, pane)
      }
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
      const ended = p.exitCode !== undefined || !!p.error
      // When that cannot be told, it is kept: a session is never ended on a guess.
      if (!ended && (await d.runsClaude(pane).catch(() => true))) return void released.add(pane)
      // Shown again meanwhile: it stays.
      if (shown(pane)) return
      await d.layout.getState().closePane(pane)
    },

    markIdle(pane, sessionId) {
      idle.set(pane, sessionId)
    },
    isIdle,

    async lost(pane) {
      if (!released.has(pane) || shown(pane) || !panes()[pane]) return false
      released.delete(pane)
      await d.layout.getState().closePane(pane)
      return true
    },
  }
}

/** Tab ids follow the Claude session their pane runs (`Pane.sessionId`, which the session poll
 *  keeps current): a shell where `claude` was typed, a `claude --resume` that took another id, a
 *  `/clear`. The tab becomes that session's captain's. A robot's tab is its child's, whatever its
 *  pane runs; a pane `isIdle` for its id is no captain's. */
export function followPanes(nexus: StoreApi<NexusState>, panes: Record<PaneId, Pick<Pane, 'sessionId'>>, isIdle: (pane: PaneId, sessionId: string) => boolean = () => false): void {
  for (const t of nexus.getState().tabs) {
    if (t.kind === 'robot' || !t.key?.startsWith('pane:')) continue
    const pane = Number(t.key.slice(5))
    const sessionId = panes[pane]?.sessionId
    // An id found running no Claude there is not followed: the tab stays a shell's (#460).
    if (!sessionId || sessionId === t.id || isIdle(pane, sessionId)) continue
    nexus.getState().retargetTab(t.id, { ...t, id: sessionId, kind: 'captain', sessionId })
  }
}
