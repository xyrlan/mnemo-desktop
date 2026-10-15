import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { SessionKey } from '../session/host'
import type { LogEvent } from './ship-types'
import { readWidth } from './drawer/width'

/** How many milestones the ship's log keeps while the app runs (it is not persisted). */
export const LOG_MAX = 500

export type NexusState = {
  /** The app opens on the Nexus (v2 spec, "Where it sits in the app"); ⌘0 and the sidebar's
   *  Nexus entry flip it. */
  open: boolean
  setOpen(open: boolean): void
  toggle(): void
  /** Robots shift+clicked, by id. */
  selection: ReadonlySet<string>
  toggleSelect(id: string): void
  clearSelection(): void
  triage: boolean
  setTriage(open: boolean): void
  /** The ship's log, oldest first, at most `LOG_MAX`; an event already logged (same `id`) is skipped. */
  log: LogEvent[]
  appendLog(events: LogEvent[]): void
  /** The session the drawer shows; its figure is highlighted. */
  focusId: string | null
  setFocus(id: string | null): void
  /** The drawer's tabs, in the order they were opened: one per session. The holds are the
   *  drawer's (`drawer/sessions.ts`); these only say what is shown. */
  tabs: DrawerTab[]
  /** The tab shown, by figure id; `focusId` while the drawer is not collapsed. */
  activeTab: string | null
  /** Collapsed to a handle on the right edge: every tab is still held. */
  collapsed: boolean
  /** The drawer's width in px, remembered per machine (`drawer/width.ts`). */
  drawerWidth: number
  /** Adds `tab` (or replaces the one of its id) and shows it, expanding the drawer. */
  putTab(tab: DrawerTab): void
  /** Shows tab `id`, expanding the drawer. */
  activateTab(id: string): void
  /** Takes tab `id` away; the tab opened last is shown in its place. */
  removeTab(id: string): void
  /** Collapses or expands the drawer; it never collapses with no tab. */
  setCollapsed(collapsed: boolean): void
  setDrawerWidth(width: number): void
}

/** A session open in the drawer. `id`: the figure's (a robot's, a captain's). `key`: the session
 *  host's key while the tab shows its live terminal; null when it shows the conversation read-only,
 *  and `readOnly` says why. `label`, `sessionId`, `cwd`: what the tab knew of it as it opened, for
 *  when the ship no longer lists the figure (a merged robot leaves). */
export type DrawerTab = {
  id: string
  kind: 'robot' | 'captain'
  key: SessionKey | null
  readOnly: string | null
  label: string
  sessionId: string | null
  cwd: string | null
}

/** The highlight follows the tab shown, and is cleared while the drawer is collapsed. */
const focused = (activeTab: string | null, collapsed: boolean) => ({ activeTab, collapsed, focusId: collapsed ? null : activeTab })

export const nexusStore: StoreApi<NexusState> = createStore<NexusState>((set) => ({
  open: true,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
  selection: new Set(),
  toggleSelect: (id) =>
    set((s) => {
      const next = new Set(s.selection)
      if (!next.delete(id)) next.add(id)
      return { selection: next }
    }),
  clearSelection: () => set({ selection: new Set() }),
  triage: false,
  setTriage: (triage) => set({ triage }),
  log: [],
  appendLog: (events) =>
    set((s) => {
      if (!events.length) return s
      const seen = new Set(s.log.map((e) => e.id))
      const fresh = events.filter((e) => !seen.has(e.id) && seen.add(e.id))
      return fresh.length ? { log: [...s.log, ...fresh].slice(-LOG_MAX) } : s
    }),
  focusId: null,
  setFocus: (focusId) => set({ focusId }),
  tabs: [],
  activeTab: null,
  collapsed: false,
  drawerWidth: readWidth(),
  putTab: (tab) =>
    set((s) => {
      const at = s.tabs.findIndex((t) => t.id === tab.id)
      const tabs = at < 0 ? [...s.tabs, tab] : s.tabs.map((t, i) => (i === at ? tab : t))
      return { tabs, ...focused(tab.id, false) }
    }),
  activateTab: (id) => set((s) => (s.tabs.some((t) => t.id === id) ? focused(id, false) : {})),
  removeTab: (id) =>
    set((s) => {
      if (!s.tabs.some((t) => t.id === id)) return {}
      const tabs = s.tabs.filter((t) => t.id !== id)
      const active = s.activeTab === id ? (tabs.at(-1)?.id ?? null) : s.activeTab
      return { tabs, ...focused(active, s.collapsed && tabs.length > 0) }
    }),
  setCollapsed: (collapsed) => set((s) => focused(s.activeTab, collapsed && s.tabs.length > 0)),
  setDrawerWidth: (drawerWidth) => set({ drawerWidth }),
}))

export const useNexus = <T,>(sel: (s: NexusState) => T): T => useStore(nexusStore, sel)
