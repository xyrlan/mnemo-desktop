import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { SessionKey } from '../session/host'
import type { Feed, LogEvent } from './ship-types'
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
  /** Triage asked for from outside the view (the sidebar's needs-you count): the Nexus opens, and
   *  the view opens triage only when its ship has a robot to triage (`settleTriageAsk`). The count
   *  also counts interactive sessions, which triage has no card for. */
  triageAsked: boolean
  askTriage(): void
  /** The view's answer to `askTriage`, from the ship it built: `needs` robots wait on a decision. */
  settleTriageAsk(needs: number): void
  /** The ship's log, oldest first, at most `LOG_MAX`; an event already logged (same `id`) is skipped. */
  log: LogEvent[]
  appendLog(events: LogEvent[]): void
  /** The session the drawer shows; its figure is highlighted. */
  focusId: string | null
  setFocus(id: string | null): void
  /** The last feed read, kept while the Nexus is closed: a ship built on reopen is drawn with it,
   *  not as if no session had acted since. */
  feed: Feed | null
  setFeed(feed: Feed): void
  /** The drawer's tabs, in the order they were opened: one per session. The holds are the
   *  drawer's (`drawer/sessions.ts`); these only say what is shown. */
  tabs: DrawerTab[]
  /** The tab shown, by figure id; `focusId` while the drawer is not collapsed. */
  activeTab: string | null
  /** Collapsed to a handle on the right edge: every tab is still held. */
  collapsed: boolean
  /** The drawer's width in px as dragged, remembered per machine (`drawer/width.ts`); null until
   *  one is: the default, 42% of the window as it is now. */
  drawerWidth: number | null
  /** How each tab shows its live session, by tab id: its conversation (the default, so a tab not
   *  listed shows that), or its terminal. A tab's entry goes with it. */
  faces: Record<string, DrawerFace>
  /** Adds `tab` (or replaces the one of its id) and shows it, expanding the drawer. */
  putTab(tab: DrawerTab): void
  /** Shows tab `id`, expanding the drawer. */
  activateTab(id: string): void
  /** Takes tab `id` away; the tab opened last is shown in its place. */
  removeTab(id: string): void
  /** Collapses or expands the drawer; it never collapses with no tab. */
  setCollapsed(collapsed: boolean): void
  setDrawerWidth(width: number): void
  /** Shows tab `id`'s session as `face`. */
  setFace(id: string, face: DrawerFace): void
  /** Flips tab `id` between its conversation and its terminal. */
  toggleFace(id: string): void
}

/** A tab's live session, as its conversation (with a composer that types into its terminal) or
 *  as that terminal. */
export type DrawerFace = 'conversation' | 'terminal'

export const faceOf = (s: Pick<NexusState, 'faces'>, id: string): DrawerFace => s.faces[id] ?? 'conversation'

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
  triageAsked: false,
  askTriage: () => set({ open: true, triageAsked: true }),
  settleTriageAsk: (needs) => set({ triageAsked: false, triage: needs > 0 }),
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
  feed: null,
  setFeed: (feed) => set({ feed }),
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
      const faces = { ...s.faces }
      delete faces[id]
      return { tabs, faces, ...focused(active, s.collapsed && tabs.length > 0) }
    }),
  setCollapsed: (collapsed) => set((s) => focused(s.activeTab, collapsed && s.tabs.length > 0)),
  setDrawerWidth: (drawerWidth) => set({ drawerWidth }),
  faces: {},
  setFace: (id, face) => set((s) => (faceOf(s, id) === face ? {} : { faces: { ...s.faces, [id]: face } })),
  toggleFace: (id) => set((s) => ({ faces: { ...s.faces, [id]: faceOf(s, id) === 'conversation' ? 'terminal' : 'conversation' } })),
}))

export const useNexus = <T,>(sel: (s: NexusState) => T): T => useStore(nexusStore, sel)
