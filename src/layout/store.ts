import { createStore as createZustand, type StoreApi } from 'zustand/vanilla'
import { useStore } from 'zustand'
import { closeLeaf, extract, graft, leaf, leaves, replaceRatio, splitAt, swapLeaves, type Dir, type Node, type PaneId, type Path, type Rect, type Side } from './tree'
import { layoutRects, workspaceRect } from './rects'
import { reuseHandler } from './reuse'
import { mapLeaves, parseSaved, SAVED_VERSION, TRANSIENT_VIEWS, type Saved } from './saved'
import type { PtyClient } from '../pty/client'

/** `name`: what the user renamed the tab to; it wins over the name its focused pane gives it. */
export type Tab = { id: string; root: Node; focused: PaneId; name?: string }
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
  /** Which face a terminal pane shows: the xterm (default) or its Claude session as cards (round 20).
   *  The PTY runs underneath either way. */
  face?: Face
}
export type Face = 'terminal' | 'conversation'
/** `auto`: reuse a pane of the same view in the active tab, else split right when the
 *  focused pane is wide, else split down when it is tall, else open a tab. */
export type Place = 'auto' | 'tab' | 'split-row' | 'split-col'

/** Focused panes wider than this split right under `auto`; taller than SPLIT_MIN_H split down. */
export const SPLIT_MIN_W = 900
export const SPLIT_MIN_H = 600

export type StoreOptions = {
  /** The box tabs are laid out in; null when unknown (placement then opens a tab). */
  workspace?: () => Rect | null
  /** Which of the saved sessions a running `claude` already holds (another app instance may run
   *  them); rejects when that cannot be told. None given: every saved session is resumed. */
  liveSessions?: (ids: string[]) => Promise<string[]>
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
  /** cwd: where the new pane starts; defaults to the focused pane's OSC 7 cwd. */
  split(dir: Dir, cwd?: string): Promise<void>
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
  /** Show the tab holding `id` with that pane focused; nothing when no tab holds it. */
  goToPane(id: PaneId): void
  /** Set (or, with an empty or missing name, clear) a tab's own name. */
  renameTab(id: string, name: string | undefined): void
  cycleTab(delta: 1 | -1): void
  setRatio(path: Path, ratio: number): void
  /** Exchange the places of two panes of the same tab (drag a pane bar onto another).
   *  Focus stays on the pane it was on; panes in different tabs are left alone. */
  swapPanes(a: PaneId, b: PaneId): void
  /** Take `from` out of its place and put it on `side` of `to`, which splits evenly to hold it
   *  (drag a pane bar onto another's edge). Nothing happens when `from` is `to`; focus stays on
   *  the pane it was on.
   *
   *  `tab` is the id of the group `to` belongs to, and naming it is what asks for a move across
   *  groups (dropping a pane onto another group's line in the sidebar): `from` leaves its own
   *  tree and joins that one, focused there, and a tab left with no pane closes. Without it the
   *  move stays inside one tab and a pair from two tabs is refused — on screen only the active
   *  tab is rendered, so such a pair is a stale id, and teleporting a pane is worse than doing
   *  nothing. Nothing happens when `to` is not in `tab`. */
  movePane(from: PaneId, to: PaneId, side: Side, tab?: string): void
  setCwd(id: PaneId, cwd: string): void
  /** Record (or clear) the Claude Code session a pane runs; Home and the workspace restore read it. */
  setSessionId(id: PaneId, sessionId: string | undefined): void
  /** Show pane `id`'s terminal or its conversation face. Only terminal panes have two faces. */
  setFace(id: PaneId, face: Face): void
  setTitle(id: PaneId, title: string): void
  paneExited(id: PaneId, code: number | null): void
  attachSink(id: PaneId, sink: (b: Uint8Array) => void): void
  setPalette(open: boolean): void
  /** The layout as `~/.mnemo-desktop/workspace.json` keeps it: tabs, trees with ratios, focus,
   *  and each pane's view, props, cwd, title and session. Transient views are left out. */
  snapshotForSave(): Saved
  /** Recreate the tabs of a saved workspace (what `workspace_read` returned) after the open ones:
   *  a terminal spawns a shell in its saved cwd (the core falls back to home when it is gone) and,
   *  when it ran a Claude session, types `claude --resume <id>` after the prompt unless that session
   *  is live elsewhere (or liveness cannot be told), keeping the id on the pane either way; other views
   *  reopen with their props. Resolves once every pane exists; rejects when the file holds tabs
   *  but none could be read. A missing or empty workspace restores nothing. */
  restore(saved: unknown): Promise<void>
}

export type Store = StoreApi<State & Actions>

export const DEFAULT_COLS = 80
export const DEFAULT_ROWS = 24
/** Delay before a command is typed into a fresh shell, so it lands after the prompt. */
export const PROMPT_DELAY_MS = 700

export function createStore(pty: PtyClient, opts: StoreOptions = {}): Store {
  const workspace = opts.workspace ?? (() => workspaceRect())
  const liveSessions = opts.liveSessions ?? (async () => [])
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

      async split(dir, cwd) {
        const tab = active()
        if (!tab) return
        cwd = cwd ?? get().panes[tab.focused]?.cwd
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

      goToPane(id) {
        const tab = get().tabs.find((t) => leaves(t.root).includes(id))
        if (!tab) return
        set((s) => ({ activeTab: tab.id, tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, focused: id } : t)) }))
      },

      renameTab(id, name) {
        const clean = name?.trim()
        set((s) => ({
          tabs: s.tabs.map((t) => {
            if (t.id !== id) return t
            const { name: _old, ...rest } = t
            return clean ? { ...rest, name: clean } : rest
          }),
        }))
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

      swapPanes(a, b) {
        set((s) => ({
          tabs: s.tabs.map((t) => {
            const root = swapLeaves(t.root, a, b)
            return root === t.root ? t : { ...t, root }
          }),
        }))
      },

      movePane(from, to, side, tab) {
        // Refused here, before extract: grafting onto a target that was just extracted finds
        // no target and hands back the tree without `from`, deleting the pane.
        if (from === to) return
        set((s) => {
          const src = s.tabs.find((t) => leaves(t.root).includes(from))
          const dest = tab === undefined ? src : s.tabs.find((t) => t.id === tab)
          if (!src || !dest || !leaves(dest.root).includes(to)) return {}
          if (dest === src) {
            const rest = extract(src.root, from)
            if (!rest) return {}
            const root = graft(rest, to, from, side)
            if (root === rest) return {}
            return { tabs: s.tabs.map((t) => (t === src ? { ...t, root } : t)) }
          }
          // Grafted first, and only then extracted: a graft that refuses after the pane has
          // already left its own tree is the one way a move loses a pane for good.
          const joined = graft(dest.root, to, from, side)
          if (joined === dest.root) return {}
          const rest = extract(src.root, from)
          const tabs = s.tabs.flatMap((t) => {
            if (t === dest) return [{ ...t, root: joined, focused: from }]
            if (t !== src) return [t]
            // The pane it left was the last one: the group goes with it rather than staying empty.
            if (!rest) return []
            const kept = leaves(rest)
            return [{ ...t, root: rest, focused: kept.includes(t.focused) ? t.focused : kept[0] }]
          })
          // Following the pane: the group the maintainer was looking at no longer exists.
          return { tabs, activeTab: !rest && s.activeTab === src.id ? dest.id : s.activeTab }
        })
      },

      setSessionId(id, sessionId) {
        set((s) => (s.panes[id] ? { panes: { ...s.panes, [id]: { ...s.panes[id], sessionId } } } : {}))
      },
      setFace(id, face) {
        set((s) => (s.panes[id]?.view === 'terminal' ? { panes: { ...s.panes, [id]: { ...s.panes[id], face } } } : {}))
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

      snapshotForSave() {
        const { tabs, panes, activeTab } = get()
        const out: Saved = { version: SAVED_VERSION, tabs: [], panes: {}, activeTab }
        for (const t of tabs) {
          let root: Node | null = t.root
          for (const id of leaves(t.root)) {
            const p = panes[id]
            if (!p || TRANSIENT_VIEWS.has(p.view)) root = root && closeLeaf(root, id)
          }
          if (!root) continue
          const ids = leaves(root)
          for (const id of ids) {
            const { view, props, cwd, title, sessionId, face } = panes[id]
            out.panes[String(id)] = {
              view,
              ...(props === undefined ? {} : { props }),
              ...(cwd ? { cwd } : {}),
              ...(title ? { title } : {}),
              ...(sessionId ? { sessionId } : {}),
              ...(face === 'conversation' ? { face } : {}),
            }
          }
          out.tabs.push({ id: t.id, root, focused: ids.includes(t.focused) ? t.focused : ids[0], ...(t.name ? { name: t.name } : {}) })
        }
        return out
      },

      async restore(saved) {
        const parsed = parseSaved(saved)
        if (!parsed) return
        // A session still running (another instance of the app has it) would get a second copy,
        // with its hooks and MCP servers, from `claude --resume` (#168). Unknown counts as running.
        const sessions = Object.values(parsed.panes).flatMap((p) => (p.view === 'terminal' && p.sessionId ? [p.sessionId] : []))
        const running: Set<string> | 'unknown' =
          sessions.length === 0 ? new Set() : await liveSessions(sessions).then((ids) => new Set(ids), () => 'unknown' as const)
        const made: Tab[] = []
        let active: string | undefined
        for (const t of parsed.tabs) {
          const ids = new Map<PaneId, PaneId>()
          for (const old of leaves(t.root)) {
            const p = parsed.panes[String(old)]
            if (p.view === 'terminal') {
              const id = await spawnPane(p.cwd)
              ids.set(old, id)
              if (p.face) get().setFace(id, p.face)
              if (p.sessionId) {
                // Kept on the pane even when not resumed, so the saved layout keeps it too.
                get().setSessionId(id, p.sessionId)
                const resumable = running !== 'unknown' && !running.has(p.sessionId)
                if (id > 0 && resumable) setTimeout(() => void pty.write(id, `claude --resume ${p.sessionId}\n`), PROMPT_DELAY_MS)
              }
            } else {
              const id = synthetic--
              ids.set(old, id)
              set((s) => ({ panes: { ...s.panes, [id]: { id, view: p.view, props: p.props ?? {}, title: p.title } } }))
            }
          }
          const root = mapLeaves(t.root, ids)
          const tab: Tab = { id: `tab-${leaves(root)[0]}`, root, focused: ids.get(t.focused) ?? leaves(root)[0], ...(t.name ? { name: t.name } : {}) }
          made.push(tab)
          if (t.id === parsed.activeTab) active = tab.id
        }
        set((s) => ({ tabs: [...s.tabs, ...made], activeTab: active ?? made[0]?.id ?? s.activeTab }))
      },
    }
  })
}

export const useAppStore = <T,>(store: Store, sel: (s: State & Actions) => T) => useStore(store, sel)
