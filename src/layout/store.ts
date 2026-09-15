import { createStore as createZustand, type StoreApi } from 'zustand/vanilla'
import { useStore } from 'zustand'
import { closeLeaf, leaf, leaves, replaceRatio, splitAt, type Dir, type Node, type PaneId, type Path } from './tree'
import type { PtyClient } from '../pty/client'

export type Tab = { id: string; root: Node; focused: PaneId }
export type Pane = { id: PaneId; cwd?: string; title?: string; exitCode?: number | null; error?: string }

export type State = {
  tabs: Tab[]
  activeTab: string
  panes: Record<PaneId, Pane>
  paletteOpen: boolean
  /** Output subscribers keyed by pane; set by TerminalPane on mount. */
  sinks: Record<PaneId, (b: Uint8Array) => void>
}

export type Actions = {
  newTab(cwd?: string): Promise<void>
  split(dir: Dir): Promise<void>
  closePane(): Promise<void>
  focusPane(id: PaneId): void
  goToTab(index: number): void
  cycleTab(delta: 1 | -1): void
  setRatio(path: Path, ratio: number): void
  setCwd(id: PaneId, cwd: string): void
  setTitle(id: PaneId, title: string): void
  paneExited(id: PaneId, code: number | null): void
  attachSink(id: PaneId, sink: (b: Uint8Array) => void): void
  setPalette(open: boolean): void
}

export type Store = StoreApi<State & Actions>

export const DEFAULT_COLS = 80
export const DEFAULT_ROWS = 24

export function createStore(pty: PtyClient): Store {
  return createZustand<State & Actions>((set, get) => {
    const active = () => get().tabs.find((t) => t.id === get().activeTab)
    let synthetic = -1

    /** Output that arrived before a TerminalPane attached its sink (the shell prompt
     *  usually lands before `pty.spawn` even resolves). Flushed by attachSink. */
    const pending = new Map<PaneId, Uint8Array[]>()

    async function spawnPane(cwd?: string): Promise<PaneId> {
      try {
        let assigned: PaneId | null = null
        const early: Uint8Array[] = []
        const id = await pty.spawn({
          cwd,
          cols: DEFAULT_COLS,
          rows: DEFAULT_ROWS,
          onOutput: (b) => {
            if (assigned === null) {
              early.push(b)
              return
            }
            const sink = get().sinks[assigned]
            if (sink) sink(b)
            else pending.get(assigned)?.push(b) ?? pending.set(assigned, [b])
          },
        })
        assigned = id
        if (early.length) pending.set(id, [...(pending.get(id) ?? []), ...early])
        set((s) => ({ panes: { ...s.panes, [id]: { id, cwd } } }))
        void pty.onExit(id, (code) => get().paneExited(id, code))
        return id
      } catch (e) {
        const id = synthetic--
        set((s) => ({ panes: { ...s.panes, [id]: { id, error: String(e) } } }))
        return id
      }
    }

    return {
      tabs: [],
      activeTab: '',
      panes: {},
      paletteOpen: false,
      sinks: {},

      async newTab(cwd) {
        const pane = await spawnPane(cwd)
        const tab: Tab = { id: `tab-${pane}`, root: leaf(pane), focused: pane }
        set((s) => ({ tabs: [...s.tabs, tab], activeTab: tab.id }))
      },

      async split(dir) {
        const tab = active()
        if (!tab) return
        const cwd = get().panes[tab.focused]?.cwd
        const fresh = await spawnPane(cwd)
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === tab.id ? { ...t, root: splitAt(t.root, tab.focused, fresh, dir), focused: fresh } : t,
          ),
        }))
      },

      async closePane() {
        const tab = active()
        if (!tab) return
        const closing = tab.focused
        if (closing > 0) await pty.kill(closing)
        const root = closeLeaf(tab.root, closing)
        set((s) => {
          const panes = { ...s.panes }
          delete panes[closing]
          const sinks = { ...s.sinks }
          delete sinks[closing]
          if (root === null) {
            const idx = s.tabs.findIndex((t) => t.id === tab.id)
            const tabs = s.tabs.filter((t) => t.id !== tab.id)
            const next = tabs[Math.max(0, idx - 1)]
            return { tabs, activeTab: next?.id ?? '', panes, sinks }
          }
          const focused = leaves(root)[0]
          return { tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, root, focused } : t)), panes, sinks }
        })
        if (get().tabs.length === 0) await get().newTab()
      },

      focusPane(id) {
        set((s) => ({ tabs: s.tabs.map((t) => (t.id === s.activeTab ? { ...t, focused: id } : t)) }))
      },

      goToTab(index) {
        const t = get().tabs[index]
        if (t) set({ activeTab: t.id })
      },

      cycleTab(delta) {
        const { tabs, activeTab } = get()
        if (tabs.length === 0) return
        const i = tabs.findIndex((t) => t.id === activeTab)
        set({ activeTab: tabs[(i + delta + tabs.length) % tabs.length].id })
      },

      setRatio(path, ratio) {
        set((s) => ({
          tabs: s.tabs.map((t) => (t.id === s.activeTab ? { ...t, root: replaceRatio(t.root, path, ratio) } : t)),
        }))
      },

      setCwd(id, cwd) {
        set((s) => ({ panes: { ...s.panes, [id]: { ...s.panes[id], id, cwd } } }))
      },
      setTitle(id, title) {
        set((s) => ({ panes: { ...s.panes, [id]: { ...s.panes[id], id, title } } }))
      },
      paneExited(id, code) {
        set((s) => ({ panes: { ...s.panes, [id]: { ...s.panes[id], id, exitCode: code } } }))
      },
      attachSink(id, sink) {
        set((s) => ({ sinks: { ...s.sinks, [id]: sink } }))
        for (const b of pending.get(id) ?? []) sink(b)
        pending.delete(id)
      },
      setPalette(open) {
        set({ paletteOpen: open })
      },
    }
  })
}

export const useAppStore = <T,>(store: Store, sel: (s: State & Actions) => T) => useStore(store, sel)
