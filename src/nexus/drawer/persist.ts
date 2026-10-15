import type { StoreApi } from 'zustand/vanilla'
import type { Pane } from '../../layout/store'
import type { PaneId } from '../../layout/tree'
import { basename } from '../../path/path'
import type { DrawerTab, NexusState } from '../store'
import type { Drawer } from './sessions'

/** The drawer's tabs across a restart (contract `sessions`): each tab on a pane's session (a
 *  session the Nexus started, a captain or robot in a pane) comes back on that session while the
 *  layout store still holds it: on its pane, or on the pane that resumed its Claude session. A
 *  child's attach and a read-only tab are opened again from the ship. A terminal the restore
 *  brings back that no tab shows and no figure leads to (a workbench tab's shell, before #459) is
 *  opened in a tab of its own (`adoptShells`). */

export const TABS_KEY = 'mnemo.nexus-drawer.v1'

export type SavedTab = Pick<DrawerTab, 'id' | 'kind' | 'label' | 'sessionId' | 'cwd'> & { pane: PaneId }
export type SavedTabs = { tabs: SavedTab[]; active: string | null }

const paneOfKey = (key: string | null) => (key?.startsWith('pane:') ? Number(key.slice(5)) : null)

/** What is kept of the drawer now. */
export function tabsToSave(s: Pick<NexusState, 'tabs' | 'activeTab'>): SavedTabs {
  const tabs = s.tabs.flatMap((t): SavedTab[] => {
    const pane = paneOfKey(t.key)
    return pane === null || !Number.isInteger(pane) ? [] : [{ id: t.id, kind: t.kind, label: t.label, sessionId: t.sessionId, cwd: t.cwd, pane }]
  })
  return { tabs, active: tabs.some((t) => t.id === s.activeTab) ? s.activeTab : null }
}

const KINDS = new Set<DrawerTab['kind']>(['robot', 'captain', 'session'])
const strOrNull = (x: unknown) => (typeof x === 'string' && x ? x : null)

/** The tabs kept, as far as they can be read. */
export function readTabs(storage: Pick<Storage, 'getItem'> | null): SavedTabs {
  try {
    const raw: unknown = JSON.parse(storage?.getItem(TABS_KEY) ?? 'null')
    if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as SavedTabs).tabs)) return { tabs: [], active: null }
    const tabs = (raw as { tabs: unknown[] }).tabs.flatMap((x): SavedTab[] => {
      if (typeof x !== 'object' || x === null) return []
      const t = x as Record<string, unknown>
      if (!strOrNull(t.id) || !KINDS.has(t.kind as DrawerTab['kind']) || !Number.isInteger(t.pane) || (t.pane as number) <= 0) return []
      return [{ id: t.id as string, kind: t.kind as DrawerTab['kind'], label: strOrNull(t.label) ?? (t.id as string), sessionId: strOrNull(t.sessionId), cwd: strOrNull(t.cwd), pane: t.pane as number }]
    })
    return { tabs, active: strOrNull((raw as { active?: unknown }).active) }
  } catch {
    return { tabs: [], active: null }
  }
}

export function writeTabs(storage: Pick<Storage, 'setItem'> | null, saved: SavedTabs): void {
  try {
    storage?.setItem(TABS_KEY, JSON.stringify(saved))
  } catch {
    // No storage: the tabs do not come back.
  }
}

/** Opens the kept tabs again, once the layout store is restored: each on its pane while that pane's
 *  terminal runs, else on the pane running its Claude session; the others are forgotten. The tab
 *  shown is shown again. */
export function reopenTabs(saved: SavedTabs, panes: Record<PaneId, Pane>, drawer: Drawer, nexus: StoreApi<NexusState>): void {
  const live = (p: Pane | undefined) => !!p && p.view === 'terminal' && p.id > 0 && p.exitCode === undefined && !p.error
  const bySession = (id: string | null) => (id ? Object.values(panes).find((p) => live(p) && p.sessionId === id)?.id : undefined)
  const opened: string[] = []
  for (const t of saved.tabs) {
    const pane = live(panes[t.pane]) ? t.pane : bySession(t.sessionId)
    if (pane === undefined) continue
    drawer.open({ id: t.id, kind: t.kind, key: null, readOnly: null, label: t.label, sessionId: t.sessionId, cwd: t.cwd }, { pane })
    opened.push(t.id)
  }
  const active = saved.active && opened.includes(saved.active) ? saved.active : null
  if (active) nexus.getState().activateTab(active)
}

/** Every live terminal the restore brought back that no drawer tab shows and that runs no Claude
 *  session, outside the offscreen ones: a workbench tab's shell, kept in the workspace file from
 *  before the Nexus was the app (#459), or a shell the restore found running that no saved pane
 *  claimed. Nothing on the ship leads to it, so each opens in a drawer tab of its own, after the
 *  tabs kept; the tab shown stays shown. A pane running Claude is left to its captain, as an
 *  offscreen one is. */
export function adoptShells(panes: Record<PaneId, Pane>, drawer: Drawer, nexus: StoreApi<NexusState>): void {
  const shown = new Set(nexus.getState().tabs.flatMap((t) => (t.key?.startsWith('pane:') ? [Number(t.key.slice(5))] : [])))
  const was = nexus.getState().activeTab
  for (const p of Object.values(panes)) {
    if (p.view !== 'terminal' || p.id <= 0 || p.offscreen || p.sessionId || p.exitCode !== undefined || p.error || shown.has(p.id)) continue
    const id = `session:${p.id}`
    if (nexus.getState().tabs.some((t) => t.id === id)) continue
    const label = p.title || (p.cwd ? `shell · ${basename(p.cwd) || p.cwd}` : 'shell')
    drawer.open({ id, kind: 'session', key: null, readOnly: null, label, sessionId: null, cwd: p.cwd ?? null }, { pane: p.id })
  }
  if (was) nexus.getState().activateTab(was)
}
