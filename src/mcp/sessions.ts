import type { Pane } from '../layout/store'
import type { PaneId } from '../layout/tree'
import type { DrawerTab } from '../nexus/store'
import type { HostedSession, SessionKey } from '../session/host'

/** A session of the Nexus as `desktop_list_panes` lists it (spec `2026-10-15-nexus-app-design.md`,
 *  Q16): a drawer tab, or a terminal the app runs that no tab shows. */
export type McpSession = {
  /** The terminal `desktop_terminal_read` reads. Absent when there is none to read (`note`). */
  pane?: PaneId
  /** `captain`: a Claude session the ship shows; `robot`: a dispatched child, attached; `session`:
   *  a shell or saved command the drawer started; `pane`: a terminal the app runs that no tab
   *  shows. */
  kind: DrawerTab['kind'] | 'pane'
  /** Its drawer tab, by the figure's id. */
  tab?: string
  label: string
  /** What the terminal calls itself, when it says. */
  title?: string
  cwd?: string
  /** The Claude Code session it runs. */
  sessionId?: string
  /** On screen now: the drawer shows its tab, expanded. */
  shown: boolean
  exitCode?: number | null
  /** Why there is no terminal to read: the tab shows the conversation read-only, or a child's
   *  attach is starting or could not start. */
  note?: string
}

export type Sources = {
  tabs: DrawerTab[]
  activeTab: string | null
  collapsed: boolean
  hosted: Record<SessionKey, HostedSession>
  panes: Record<PaneId, Pane>
}

const defined = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T

/** The drawer's tabs in order, then the offscreen terminals no tab shows, by id. */
export function sessionsOf(src: Sources): McpSession[] {
  const tabbed = new Set<PaneId>()
  const tabs = src.tabs.map((t): McpSession => {
    const hosted = t.key === null ? undefined : src.hosted[t.key]
    const pty = hosted?.pty ?? undefined
    if (pty !== undefined) tabbed.add(pty)
    const p = pty === undefined ? undefined : src.panes[pty]
    const note = t.key === null ? (t.readOnly ?? 'no live terminal') : !hosted ? 'its session has ended' : pty === undefined ? (hosted.error ?? 'its terminal is starting') : undefined
    return defined({
      pane: pty,
      kind: t.kind,
      tab: t.id,
      label: t.label,
      title: p?.title,
      cwd: p?.cwd ?? t.cwd ?? undefined,
      sessionId: p?.sessionId ?? t.sessionId ?? undefined,
      shown: !src.collapsed && src.activeTab === t.id,
      exitCode: p?.exitCode,
      note,
    })
  })
  const loose = Object.values(src.panes)
    .filter((p) => p.offscreen && p.view === 'terminal' && !tabbed.has(p.id))
    .sort((a, b) => a.id - b.id)
    .map((p): McpSession => defined({ pane: p.id, kind: 'pane' as const, label: p.title ?? 'terminal', cwd: p.cwd, sessionId: p.sessionId, shown: false, exitCode: p.exitCode }))
  return [...tabs, ...loose]
}
