import type { StoreApi } from 'zustand/vanilla'
import type { Pane } from '../../layout/store'
import type { PaneId } from '../../layout/tree'
import { basename } from '../../path/path'
import type { DrawerTab, NexusState } from '../store'
import type { SessionSpec } from './open'
import type { Drawer } from './sessions'

/** The sessions the Nexus starts (spec `2026-10-15-nexus-app-design.md`, Q1, Q4): each a terminal
 *  in a pane with no view on screen (`openOffscreen` in the layout store, which stays the app's
 *  session registry), shown in a drawer tab. The workbench is never shown or switched. */

/** What of the layout store the sessions use. */
export type SessionLayout = StoreApi<{
  panes: Record<PaneId, Pane>
  openOffscreen(cwd: string | undefined, cmd?: string, sessionId?: string): Promise<PaneId>
  closePane(id?: PaneId): Promise<void>
}>

export type StartDeps = {
  layout: SessionLayout
  drawer: Drawer
  nexus: StoreApi<NexusState>
  /** Settings' permission toggle, as the workbench's *Launch agent* reads it. */
  skipPermissions(): boolean
  /** A new Claude session id: a UUID (`claude --session-id`). */
  newId(): string
  /** Whether a Claude runs under pane `pane`'s shell now. */
  runsClaude(pane: PaneId): Promise<boolean>
}

export type Sessions = {
  /** Rejects with what could not be done: every caller says it, where it was asked from. */
  openSession(spec: SessionSpec): Promise<void>
  paneOf(sessionId: string): PaneId | null
  endSession(pane: PaneId): Promise<void>
  /** No drawer tab shows pane `pane` any more (`Release.letGo`): an offscreen pane ends unless a
   *  Claude runs in it, whose captain opens it again. A shell or a saved command, ended or not, has
   *  nothing on the ship to come back from. */
  letGo(pane: PaneId): Promise<void>
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

  function paneOf(sessionId: string): PaneId | null {
    if (!sessionId) return null
    return Object.values(panes()).find((p) => p.view === 'terminal' && p.id > 0 && p.exitCode === undefined && !p.error && p.sessionId === sessionId)?.id ?? null
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
        // A session one of the app's panes runs already is shown, never started a second time.
        const running = spec.resume ? paneOf(spec.resume) : null
        const id = spec.resume ?? d.newId()
        const tab: DrawerTab = { id, kind: 'captain', key: null, readOnly: null, label, sessionId: id, cwd: spec.root }
        if (running !== null) return show(tab, running)
        const cmd = claudeCommand(d.skipPermissions(), spec.resume ? { resume: spec.resume } : { sessionId: id })
        let pane: PaneId
        try {
          pane = await d.layout.getState().openOffscreen(spec.root, cmd, id)
        } catch (e) {
          throw failed(`Could not start claude in ${spec.root}`, e)
        }
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
      if (!p?.offscreen) return
      const ended = p.exitCode !== undefined || !!p.error
      // When that cannot be told, it is kept: a session is never ended on a guess.
      if (!ended && (await d.runsClaude(pane).catch(() => true))) return
      // Shown again meanwhile: it stays.
      if (d.nexus.getState().tabs.some((t) => t.key === tabKey(pane))) return
      await d.layout.getState().closePane(pane)
    },
  }
}

/** Tab ids follow the Claude session their pane runs (`Pane.sessionId`, which the session poll
 *  keeps current): a shell where `claude` was typed, a `claude --resume` that took another id, a
 *  `/clear`. The tab becomes that session's captain's. A robot's tab is its child's, whatever its
 *  pane runs. */
export function followPanes(nexus: StoreApi<NexusState>, panes: Record<PaneId, Pick<Pane, 'sessionId'>>): void {
  for (const t of nexus.getState().tabs) {
    if (t.kind === 'robot' || !t.key?.startsWith('pane:')) continue
    const sessionId = panes[Number(t.key.slice(5))]?.sessionId
    if (!sessionId || sessionId === t.id) continue
    nexus.getState().retargetTab(t.id, { ...t, id: sessionId, kind: 'captain', sessionId })
  }
}
