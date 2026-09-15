import { createStore as createZustand, type StoreApi } from 'zustand/vanilla'
import { useStore } from 'zustand'
import { closeLeaf, leaf, leaves, replaceRatio, splitAt, type Dir, type Node, type PaneId, type Path, type Rect } from './tree'
import { layoutRects, workspaceRect } from './rects'
import { reuseHandler } from './reuse'
import type { PtyClient } from '../pty/client'

export type Tab = { id: string; root: Node; focused: PaneId }
/** `view` names the registered renderer (see panes/registry). Terminal panes have a
 *  positive id issued by the Rust core; every other view gets a negative synthetic id
 *  and never crosses the PTY boundary. */
export type Pane = {
  id: PaneId
  view: string
  props?: Record<string, unknown>
  cwd?: string
  title?: string
  exitCode?: number | null
  error?: string
  /** The Claude Code session this terminal runs, when opened for one (Home focuses it instead of forking). */
  sessionId?: string
}
/** `auto`: reuse a pane of the same view in the active tab, else split right when the
 *  focused pane is wide, else split down when it is tall, else open a tab. */
export type Place = 'auto' | 'tab' | 'split-row' | 'split-col'

/** Focused panes wider than this split right under `auto`; taller than SPLIT_MIN_H split down. */
export const SPLIT_MIN_W = 900
export const SPLIT_MIN_H = 600

export type StoreOptions = {
  /** The box tabs are laid out in; null when unknown (placement then opens a tab). */
  workspace?: () => Rect | null
}

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
  /** Show Home without closing anything: clears `activeTab`; any tab click restores. */
  showHome(): void
  /** New terminal tab in `cwd` that types `cmd` once the shell prompt is up; `sessionId`
   *  marks the pane as running that Claude session so Home can focus it instead of forking. */
  openCommandTab(cwd: string | undefined, cmd: string, sessionId?: string): Promise<void>
  split(dir: Dir): Promise<void>
  /** Open a non-terminal view (editor, browser, mission…) as a new tab, a split of the focused
   *  pane, or (`auto`) wherever it fits best. */
  openView(view: string, props: Record<string, unknown>, place: Place, title?: string): void
  closePane(): Promise<void>
  /** Close every pane of the active tab except the focused one. */
  closeOthers(): Promise<void>
  /** Close every pane of a tab (kills their PTYs) and the tab itself. */
  closeTab(id: string): Promise<void>
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
/** Delay before a command is typed into a fresh shell, so it lands after the prompt. */
export const PROMPT_DELAY_MS = 700

export function createStore(pty: PtyClient, opts: StoreOptions = {}): Store {
  const workspace = opts.workspace ?? (() => workspaceRect())
  return createZustand<State & Actions>((set, get) => {
    const active = () => get().tabs.find((t) => t.id === get().activeTab)
    let synthetic = -1

    /** Output that arrived before a TerminalPane attached its sink (the shell prompt
     *  usually lands before `pty.spawn` even resolves). Flushed by attachSink. */
    const pending = new Map<PaneId, Uint8Array[]>()

    /** Hands new props to an open pane: its view's handler decides, else they replace the old ones. */
    function reuse(id: PaneId, view: string, props: Record<string, unknown>, title?: string): boolean {
      const handler = reuseHandler(view)
      if (handler) return handler(id, props)
      set((s) => ({ panes: { ...s.panes, [id]: { ...s.panes[id], props, ...(title === undefined ? {} : { title }) } } }))
      return true
    }

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
        set((s) => ({ panes: { ...s.panes, [id]: { id, view: 'terminal', cwd } } }))
        void pty.onExit(id, (code) => get().paneExited(id, code))
        return id
      } catch (e) {
        const id = synthetic--
        set((s) => ({ panes: { ...s.panes, [id]: { id, view: 'terminal', error: String(e) } } }))
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

      showHome() {
        set({ activeTab: '' })
      },

      async openCommandTab(cwd, cmd, sessionId) {
        const pane = await spawnPane(cwd)
        const tab: Tab = { id: `tab-${pane}`, root: leaf(pane), focused: pane }
        set((s) => ({
          tabs: [...s.tabs, tab],
          activeTab: tab.id,
          panes: { ...s.panes, [pane]: { ...s.panes[pane], id: pane, sessionId } },
        }))
        if (pane > 0) setTimeout(() => void pty.write(pane, cmd + '\n'), PROMPT_DELAY_MS)
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
      },

      openView(view, props, place, title) {
        const tab = active()
        if (place === 'auto' && tab) {
          const same = leaves(tab.root).filter((p) => get().panes[p]?.view === view)
          const target = same.includes(tab.focused) ? tab.focused : same[0]
          if (target !== undefined && reuse(target, view, props, title)) return get().focusPane(target)
          const box = workspace()
          const r = box && layoutRects(tab.root, box).get(tab.focused)
          place = !r ? 'tab' : r.w > SPLIT_MIN_W ? 'split-row' : r.h > SPLIT_MIN_H ? 'split-col' : 'tab'
        }
        const id = synthetic--
        set((s) => ({ panes: { ...s.panes, [id]: { id, view, props, title } } }))
        if (place === 'tab' || place === 'auto' || !tab) {
          const t: Tab = { id: `tab-${id}`, root: leaf(id), focused: id }
          set((s) => ({ tabs: [...s.tabs, t], activeTab: t.id }))
          return
        }
        const dir: Dir = place === 'split-row' ? 'row' : 'col'
        set((s) => ({
          tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, root: splitAt(t.root, tab.focused, id, dir), focused: id } : t)),
        }))
      },

      async closeOthers() {
        const tab = active()
        if (!tab) return
        const keep = tab.focused
        const ids = leaves(tab.root).filter((p) => p !== keep)
        for (const p of ids) if (p > 0) await pty.kill(p)
        set((s) => {
          const panes = { ...s.panes }
          const sinks = { ...s.sinks }
          for (const p of ids) {
            delete panes[p]
            delete sinks[p]
          }
          return { tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, root: leaf(keep), focused: keep } : t)), panes, sinks }
        })
      },

      async closeTab(id) {
        const tab = get().tabs.find((t) => t.id === id)
        if (!tab) return
        const ids = leaves(tab.root)
        for (const p of ids) if (p > 0) await pty.kill(p)
        set((s) => {
          const panes = { ...s.panes }
          const sinks = { ...s.sinks }
          for (const p of ids) {
            delete panes[p]
            delete sinks[p]
          }
          const idx = s.tabs.findIndex((t) => t.id === id)
          const tabs = s.tabs.filter((t) => t.id !== id)
          const next = s.activeTab === id ? tabs[Math.max(0, idx - 1)]?.id ?? '' : s.activeTab
          return { tabs, activeTab: next, panes, sinks }
        })
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
