import { createStore as createZustand, type StoreApi } from 'zustand/vanilla'
import { useStore } from 'zustand'
import { closeLeaf, extract, graft, leaf, leaves, replaceRatio, splitAt, swapLeaves, type Dir, type Node, type PaneId, type Path, type Rect, type Side } from './tree'
import { reuseHandler, showsHandler } from './reuse'
import { mapGroups, mapLeaves, parseSaved, SAVED_VERSION, TRANSIENT_VIEWS, type Saved, type SavedLayout, type SavedTab, type SavedWorktree } from './saved'
import {
  dropTab,
  EMPTY_LAYOUT,
  groupIds,
  groupRatioAt,
  groupToward,
  isTerminalTab,
  joinTabs,
  kept,
  moveTabIn,
  previewIn,
  putBeside,
  putTab,
  showTab,
  targetGroup,
  tidy,
  withTab,
} from './groups'
import type { PtyClient } from '../pty/client'
import { providedSessions, type PtyInfo, type SessionClient } from '../terminal/sessions'

/** `name`: what the user renamed the tab to; it wins over the name its focused pane gives it.
 *  `preview`: the tab the next preview opened in its group replaces (a file looked at, not kept). */
export type Tab = { id: string; root: Node; focused: PaneId; name?: string; preview?: boolean }
/** An ordered set of tabs, one of them shown (`activeTab`). Every group draws its own tab row. */
export type Group = { id: string; tabs: string[]; activeTab: string }
/** A worktree's workbench: a split tree of groups, each split with a direction and a ratio. */
export type GroupNode = { kind: 'group'; group: string } | { kind: 'split'; dir: Dir; ratio: number; children: [GroupNode, GroupNode] }
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
/** Where `openView` puts a view. None of them splits a pane: only a terminal tab splits inside
 *  itself (`split`), and every other view is a tab of one pane.
 *  - `auto`: the tab already showing it (a view that registered `shows`), else a tab of the same
 *    view that takes the new props (`registerReuse`), else a new tab in the active group;
 *  - `tab`: a new tab in the active group;
 *  - `split-row` / `split-col`: "to the side" — a new tab in the group to the right of, or below,
 *    the active group, which is made when there is none. */
export type Place = 'auto' | 'tab' | 'split-row' | 'split-col'
/** `preview`: open as the target group's preview tab, replacing the one it has (only files are). */
export type OpenOptions = { preview?: boolean }
/** Where `moveTab` puts a tab: into a group at `index` (at its end by default), or into a new
 *  group made on `side` of one. */
export type TabTarget = { group: string; index?: number } | { group: string; side: Side }

export type StoreOptions = {
  /** The box tabs are laid out in; null when unknown. No placement reads it any more (nothing
   *  splits by size); kept so callers that pass it keep compiling. */
  workspace?: () => Rect | null
  /** Which of the saved sessions a running `claude` already holds (another app instance may run
   *  them); rejects when that cannot be told. None given: every saved session is resumed. */
  liveSessions?: (ids: string[]) => Promise<string[]>
  /** The terminals that outlived the page, for `restore` to attach its panes to. None given: the
   *  client the terminal view provides (`provideSessions`), else every terminal spawns anew. */
  sessions?: SessionClient
}

/** A worktree's workbench: its tabs, in the order its groups hold them; the split tree of those
 *  groups; the group the user is in; and the tab that group shows (`''`: none, Home shows). */
export type WorktreeLayout = { tabs: Tab[]; activeTab: string; groups: Record<string, Group>; groupRoot: GroupNode | null; activeGroup: string }

/** The key under `parked` of the tabs that belong to no open worktree: shells that outlived the
 *  page in a folder none holds. They keep running, never show in a worktree's strip, and are
 *  reached from the strip's own menu (`bringTab`); a worktree that opens later holding one's
 *  folder takes it. Never a path: `worktrees` never lists it and nothing switches to it. */
export const ELSEWHERE = ''

export type State = {
  /** Every tab of the shown worktree, across its groups, in their order: what is on screen now. */
  tabs: Tab[]
  /** The tab the active group shows (its focused pane has the keys); `''` while Home shows. */
  activeTab: string
  /** The shown worktree's groups, by id; each lists its tabs. */
  groups: Record<string, Group>
  /** The split tree of those groups; null with no tab. */
  groupRoot: GroupNode | null
  /** The group last clicked or focused inside; `''` with no tab. */
  activeGroup: string
  /** Every open pane, of every open worktree: a worktree that is not shown keeps its panes running,
   *  and pane ids are unique across worktrees. Which of them are on screen is what `tabs` holds. */
  panes: Record<PaneId, Pane>
  /** The worktree shown now; `tabs` and `activeTab` are its layout. `null` until one is chosen:
   *  the tabs opened before then belong to no worktree, and join the first one switched to. */
  activeWorktree: string | null
  /** The open worktrees, in the order they were opened; the shown one is among them. */
  worktrees: string[]
  /** The layouts of the open worktrees not shown now, by path; and under `ELSEWHERE`, the tabs
   *  of no open worktree. */
  parked: Record<string, WorktreeLayout>
  paletteOpen: boolean
  /** Output subscribers keyed by pane; set by TerminalPane on mount. */
  sinks: Record<PaneId, (b: Uint8Array) => void>
}

export type Actions = {
  /** Show worktree `path`'s workbench: the one shown is parked with its panes running, and `path`
   *  comes back as it was left, or opens with no tab. Tabs opened before any worktree was chosen
   *  join it, and so do the tabs `ELSEWHERE` whose folder it holds, without being shown. */
  switchWorktree(path: string): Promise<void>
  /** Kill every pane of worktree `path` and forget its layout. When it was shown, the worktree
   *  opened before it shows instead (else the one after, else none). */
  closeWorktree(path: string): Promise<void>
  /** The open worktrees, in the order they were opened. The same array until one opens or closes. */
  openWorktrees(): string[]
  /** An open worktree's tabs, shown or not; none for a worktree that is not open. The same array
   *  until its tabs change, so it can be selected from the store. */
  worktreeTabs(path: string): Tab[]
  /** An open worktree's whole layout, shown or parked, and that of the tabs `ELSEWHERE` (when there
   *  are any); undefined for a worktree that is not open. The same object until that layout
   *  changes (a switch of worktree is not a change), so it can be selected from the store. */
  worktreeLayout(path: string): WorktreeLayout | undefined
  /** A terminal tab in the active group, in `cwd`, else in the shown worktree, else in the core's
   *  default (home). */
  newTab(cwd?: string): Promise<void>
  /** Show Home without closing anything: clears `activeTab`; any tab click restores. */
  showHome(): void
  /** New terminal tab in the active group, in `cwd`, that types `cmd` once the shell prompt is up;
   *  `sessionId` marks the pane as running that Claude session so Home can focus it instead of forking. */
  openCommandTab(cwd: string | undefined, cmd: string, sessionId?: string): Promise<void>
  /** ⌘D (`row`) and ⌘⇧D (`col`). In a terminal tab: split its focused pane. In any other tab: a new
   *  terminal tab in the group to the right (below), made when there is none. cwd: where the new
   *  shell starts; defaults to the focused pane's OSC 7 cwd. */
  split(dir: Dir, cwd?: string): Promise<void>
  /** Open a non-terminal view (editor, browser, mission…) as a tab where `place` says (see `Place`).
   *  With `preview` it is the target group's preview. One without `preview` that lands on a
   *  preview tab keeps it. */
  openView(view: string, props: Record<string, unknown>, place: Place, title?: string, opts?: OpenOptions): void
  /** Close the focused pane of the active tab (⌘W); a tab left with no pane closes, and a group
   *  left with no tab collapses. */
  closePane(): Promise<void>
  /** Close every pane of the active tab except the focused one. */
  closeOthers(): Promise<void>
  /** Close every pane of a tab (kills their PTYs) and the tab itself, in whichever worktree holds it. */
  closeTab(id: string): Promise<void>
  /** Focus pane `id` of the shown worktree: its tab shows in its group, which becomes active. */
  focusPane(id: PaneId): void
  /** The Nth tab of the active group (⌃1–9). */
  goToTab(index: number): void
  /** Show the tab holding `id` with that pane focused, switching to its worktree when it is not
   *  the one shown (a tab of no worktree comes to the one shown); nothing when no tab holds it. */
  goToPane(id: PaneId): void
  /** Show tab `id` in its group, which becomes the active group (a click on it). */
  activateTab(id: string): void
  /** Move tab `id` within its row, into another group, or into a new group on a side of one (a
   *  tab dragged, "Move Tab to Split"). It is kept (no longer a preview). Into another group it
   *  shows there and that group becomes active; a group it leaves empty collapses. Nothing
   *  happens when the move would leave things as they were. */
  moveTab(id: string, to: TabTarget): void
  /** Take `pane` out of its tab and make it a tab of its own in `to.group` (a terminal pane's bar
   *  dropped on a tab row), shown there. Only a pane that shares its tab with another. */
  detachPane(pane: PaneId, to: { group: string; index?: number }): void
  /** Keep tab `id`: it is no longer a preview. */
  keepTab(id: string): void
  /** Make group `id` the active group, and the tab it shows the active tab. */
  focusGroup(id: string): void
  /** Resize the seam between groups at `path` of the group tree, held between 15% and 85%. */
  setGroupRatio(path: Path, ratio: number): void
  /** Move tab `id` of no open worktree (`ELSEWHERE`) into the active group of the one shown, and show it. */
  bringTab(id: string): void
  /** Set (or, with an empty or missing name, clear) a tab's own name. */
  renameTab(id: string, name: string | undefined): void
  /** The previous or next tab of the active group (⌘⇧[ / ⌘⇧]). */
  cycleTab(delta: 1 | -1): void
  setRatio(path: Path, ratio: number): void
  /** Exchange the places of two panes of the same tab (drag a pane bar onto another).
   *  Focus stays on the pane it was on; panes in different tabs are left alone. */
  swapPanes(a: PaneId, b: PaneId): void
  /** Take `from` out of its place and put it on `side` of `to`, which splits evenly to hold it
   *  (drag a pane bar onto another's edge). Nothing happens when `from` is `to`; focus stays on
   *  the pane it was on.
   *
   *  `tab` is the id of the tab `to` belongs to, and naming it is what asks for a move across
   *  tabs (dropping a pane onto another tab's line in the sidebar): `from` leaves its own
   *  tree and joins that one, focused there, and a tab left with no pane closes. Only terminals
   *  move across, into a tab of terminals: only a terminal tab splits. Without `tab` the move
   *  stays inside one tab and a pair from two tabs is refused — such a pair is a stale id, and
   *  teleporting a pane is worse than doing nothing. Nothing happens when `to` is not in `tab`. */
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
  /** The layout as `~/.mnemo-desktop/workspace.json` keeps it, per open worktree: tabs, trees
   *  with ratios, focus, previews, the group tree with its ratios and each group's tab order and
   *  shown tab, the active group, and each pane's view, props, cwd, title and session; and which
   *  worktree is shown. The tabs of no worktree are the layout of path `null`. Transient views are
   *  left out. */
  snapshotForSave(): Saved
  /** Recreate the worktrees of a saved workspace (what `workspace_read` returned), each one's tabs
   *  after the ones it already has, and show the worktree that was shown, which comes back first.
   *  A worktree that had no tab of its own before comes back with its saved groups.
   *
   *  A terminal whose shell kept running (`StoreOptions.sessions`: the core's terminals outlive the
   *  page and the app) attaches to it again under its saved id, its screen and scrollback first,
   *  and nothing is typed into it. Otherwise it spawns a shell in its saved cwd (else its worktree; the core falls
   *  back to home when it is gone) and, when it ran a Claude session, types `claude --resume <id>`
   *  after the prompt unless that session is live elsewhere (or liveness cannot be told), keeping the
   *  id on the pane either way. Other views reopen with their props.
   *
   *  The layout of no worktree comes back shown when the file showed no worktree, else `ELSEWHERE`.
   *
   *  Then, whatever the file held (or failed to), a shell no saved pane claims — opened too late to
   *  be saved, or the file lost — comes back as a tab of its own, in the open worktree holding its
   *  folder (else `ELSEWHERE`, never in a worktree it is not in), without changing what is shown;
   *  a terminal whose program ended is forgotten. Resolves once every pane exists; rejects when
   *  the file holds tabs but none could be read. A missing or empty workspace restores nothing of
   *  its own. */
  restore(saved: unknown): Promise<void>
}

export type Store = StoreApi<State & Actions>

export const DEFAULT_COLS = 80
export const DEFAULT_ROWS = 24
/** Delay before a command is typed into a fresh shell, so it lands after the prompt. */
export const PROMPT_DELAY_MS = 700

/** The shown layout's fields of the state. */
const fields = (l: WorktreeLayout): WorktreeLayout => ({ tabs: l.tabs, activeTab: l.activeTab, groups: l.groups, groupRoot: l.groupRoot, activeGroup: l.activeGroup })
const sameShown = (a: WorktreeLayout, b: WorktreeLayout) =>
  a.tabs === b.tabs && a.activeTab === b.activeTab && a.groups === b.groups && a.groupRoot === b.groupRoot && a.activeGroup === b.activeGroup

export function createStore(pty: PtyClient, opts: StoreOptions = {}): Store {
  const liveSessions = opts.liveSessions ?? (async () => [])
  return createZustand<State & Actions>((rawSet, get, api) => {
    const active = () => get().tabs.find((t) => t.id === get().activeTab)
    let synthetic = -1
    let groupSeq = 0

    /** A group id no open layout uses. */
    function fresh(): string {
      const s = get()
      const taken = (id: string) => id in s.groups || Object.values(s.parked).some((l) => id in l.groups)
      let id: string
      do id = `group-${++groupSeq}`
      while (taken(id))
      return id
    }

    /** `tab-<pane>`, the id every tab gets from the pane it opens with, unless a tab has it. */
    function tabId(pane: PaneId): string {
      const s = get()
      const taken = (id: string) => s.tabs.some((t) => t.id === id) || Object.values(s.parked).some((l) => l.tabs.some((t) => t.id === id))
      let id = `tab-${pane}`
      for (let n = 2; taken(id); n++) id = `tab-${pane}-${n}`
      return id
    }

    /** The last layout object handed out for the shown worktree: `worktreeLayout` keeps returning
     *  it while its fields are the state's, and a switch parks it as it is. */
    let memo: WorktreeLayout = EMPTY_LAYOUT
    function shown(s: State): WorktreeLayout {
      return sameShown(memo, s) ? memo : (memo = fields(s))
    }

    /** Every write goes through here, the store's own and `setState` from outside alike: the shown
     *  layout and any parked one that changed come out whole (`tidy`). So a test, or a caller, that
     *  sets `tabs` and `activeTab` alone gets them as one group holding every tab. */
    function settle(prev: State, next: State): State {
      let out = next
      if (!sameShown(prev, next)) {
        const l = tidy(fields(next), fresh)
        if (!sameShown(l, next)) out = { ...out, ...fields(l) }
      }
      if (next.parked !== prev.parked) {
        let parked = next.parked
        for (const [path, l] of Object.entries(next.parked)) {
          if (prev.parked[path] === l) continue
          const whole = tidy(l, fresh)
          if (whole !== l) parked = { ...parked, [path]: whole }
        }
        if (parked !== next.parked) out = { ...out, parked }
      }
      return out
    }
    const set = ((partial: unknown, replace?: boolean) =>
      rawSet(
        ((s: State & Actions) => {
          const next = typeof partial === 'function' ? (partial as (s: State & Actions) => Partial<State & Actions>)(s) : (partial as Partial<State & Actions>)
          if (next === s) return s
          return settle(s, (replace ? next : { ...s, ...next }) as State & Actions) as State & Actions
        }) as never,
        replace as never,
      )) as typeof api.setState
    api.setState = set

    /** The change that applies `fn` to the layout holding tab `id`, shown or parked (a tab may
     *  change worktree under an await: a switch parks it); `{}` when none holds it or nothing changes. */
    function inLayoutOf(s: State, id: string, fn: (l: WorktreeLayout) => WorktreeLayout): Partial<State> {
      const holds = (l: WorktreeLayout) => l.tabs.some((t) => t.id === id)
      if (holds(s)) {
        const l = shown(s)
        const next = fn(l)
        return next === l ? {} : fields(next)
      }
      for (const [path, l] of Object.entries(s.parked)) {
        if (!holds(l)) continue
        const next = fn(l)
        return next === l ? {} : { parked: { ...s.parked, [path]: next } }
      }
      return {}
    }

    /** The change that applies `fn` to worktree `where`'s layout: the shown one when `where` is it
     *  (or is `null`: asked for before any worktree was chosen), else its parked one. A worktree
     *  closed meanwhile opens again rather than lose what `fn` adds. */
    function inWorktree(s: State, where: string | null, fn: (l: WorktreeLayout) => WorktreeLayout): Partial<State> {
      if (where === null || where === s.activeWorktree) return fields(fn(shown(s)))
      const worktrees = where === ELSEWHERE || s.worktrees.includes(where) ? s.worktrees : [...s.worktrees, where]
      return { worktrees, parked: { ...s.parked, [where]: fn(s.parked[where] ?? EMPTY_LAYOUT) } }
    }

    /** Puts `tab` in worktree `where` and shows it: in group `at.group` when it is still there
     *  (the group asked from; else the active group), or `at.side` of it. The worktree is the one
     *  it was when the tab was asked for: a switch while its shell spawned leaves it there. */
    function land(where: string | null, tab: Tab, at: { group?: string; side?: Side } = {}) {
      set((s) =>
        inWorktree(s, where, (l) => {
          const g = at.group !== undefined && l.groups[at.group] ? at.group : l.groups[l.activeGroup] ? l.activeGroup : undefined
          const placed = at.side && g !== undefined ? putBeside(l, tab, g, at.side, fresh) : putTab(l, tab, g, undefined, fresh)
          return showTab(placed, tab.id)
        }),
      )
    }

    /** Puts the restored layout `r` in worktree `where`, showing its shown tab (`ELSEWHERE` shows
     *  none): as it was saved when the worktree has no tab yet, else its tabs after the ones there. */
    function addLayout(where: string | null, r: WorktreeLayout) {
      if (r.tabs.length === 0) return
      set((s) =>
        inWorktree(s, where, (l) => {
          const merged = l.tabs.length === 0 ? r : joinTabs(l, r.tabs, fresh)
          return where === ELSEWHERE ? { ...merged, activeTab: '' } : showTab(merged, r.activeTab || r.tabs[0].id)
        }),
      )
    }

    /** Shows worktree `path` at once (goToPane cannot wait). */
    function swap(path: string) {
      if (path === ELSEWHERE) return
      set((s) => {
        if (s.activeWorktree === path) return {}
        const parked = { ...s.parked }
        let next = parked[path] ?? EMPTY_LAYOUT
        delete parked[path]
        // The tabs of no worktree whose folder this one holds are its own now; what shows stays.
        const away = parked[ELSEWHERE]
        const mine = away?.tabs.filter((t) => inside(s.panes[t.focused]?.cwd, path)) ?? []
        if (mine.length) {
          next = joinTabs(next, mine, fresh)
          parked[ELSEWHERE] = mine.reduce((l, t) => dropTab(l, t.id), away)
        }
        const worktrees = s.worktrees.includes(path) ? s.worktrees : [...s.worktrees, path]
        if (s.activeWorktree !== null) {
          parked[s.activeWorktree] = shown(s)
          memo = next
          return { activeWorktree: path, worktrees, parked, ...fields(next) }
        }
        // Tabs of no worktree have nowhere else to live: they join this one, after its own.
        const loose = shown(s)
        const joined = next.tabs.length === 0 ? loose : joinTabs(next, loose.tabs, fresh)
        const showing = next.activeTab || s.activeTab
        return { activeWorktree: path, worktrees, parked, ...fields(showing ? showTab(joined, showing) : joined) }
      })
    }

    /** Output that arrived before a TerminalPane attached its sink (the shell prompt
     *  usually lands before `pty.spawn` even resolves). Flushed by attachSink. */
    const pending = new Map<PaneId, Uint8Array[]>()
    /** What attachSink flushed, handed again to the next sink until live output reaches one: a view
     *  mounted twice in a row (StrictMode) would otherwise draw a restored screen into the first,
     *  discarded terminal and leave the second blank. */
    const replay = new Map<PaneId, Uint8Array[]>()

    /** Output of terminal `id`: to its view, else kept for when it mounts. */
    function route(id: PaneId, b: Uint8Array) {
      const sink = get().sinks[id]
      if (sink) {
        replay.delete(id)
        sink(b)
      } else pending.get(id)?.push(b) ?? pending.set(id, [b])
    }

    /** Hands new props to an open pane: its view's handler decides, else they replace the old ones. */
    function reuse(id: PaneId, view: string, props: Record<string, unknown>, title?: string): boolean {
      const handler = reuseHandler(view)
      if (handler) return handler(id, props)
      set((s) => ({ panes: { ...s.panes, [id]: { ...s.panes[id], props, ...(title === undefined ? {} : { title }) } } }))
      return true
    }

    /** Shows tab `id` with pane `pane` focused, kept unless `preview` asked for a preview. */
    function reveal(id: string, pane: PaneId, preview: boolean) {
      set((s) => inLayoutOf(s, id, (l) => showTab(withTab(l, id, (t) => {
        const next = t.focused === pane ? t : { ...t, focused: pane }
        return preview ? next : kept(next)
      }), id)))
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
            if (assigned === null) early.push(b)
            else route(assigned, b)
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

    /** Pane `id` on terminal `id`, whose program kept running: what it shows now goes to the view
     *  first, then what it prints. False, and no pane, when it cannot be attached. */
    async function attachPane(sessions: SessionClient, id: PaneId, cwd: string | undefined): Promise<boolean> {
      set((s) => ({ panes: { ...s.panes, [id]: { id, view: 'terminal', ...(cwd ? { cwd } : {}) } } }))
      // Listening before attaching: an exit right after is not missed.
      const unlisten = await pty.onExit(id, (code) => get().paneExited(id, code))
      let attached = false
      const early: Uint8Array[] = []
      try {
        const screen = await sessions.attach(id, (b) => (attached ? route(id, b) : early.push(b)))
        pending.set(id, [...(screen.length ? [screen] : []), ...early])
        attached = true
        return true
      } catch {
        unlisten()
        set((s) => {
          const panes = { ...s.panes }
          delete panes[id]
          return { panes }
        })
        return false
      }
    }

    /** The open worktree holding `folder` (the deepest), else `ELSEWHERE`. */
    function worktreeOf(folder: string): string {
      return get().worktrees.filter((w) => inside(folder, w)).sort((a, b) => b.length - a.length)[0] ?? ELSEWHERE
    }

    /** Shells that kept running with no saved pane to claim them come back as tabs, where their
     *  folder is, in its active group; the ended are forgotten. What is shown stays shown. */
    async function adopt(sessions: SessionClient, orphans: PtyInfo[]) {
      for (const info of orphans) {
        if (!info.alive) {
          void pty.kill(info.id)
          continue
        }
        if (!(await attachPane(sessions, info.id, info.cwd || undefined))) continue
        const tab: Tab = { id: `tab-${info.id}`, root: leaf(info.id), focused: info.id }
        const where = worktreeOf(info.cwd)
        set((s) => inWorktree(s, where, (l) => putTab(l, tab, undefined, undefined, fresh)))
      }
    }

    /** The saved layout, `reattach` putting each terminal pane back on its shell when it can. */
    async function restoreSaved(saved: unknown, reattach: (old: PaneId, cwd: string | undefined) => Promise<boolean>) {
      const parsed = parseSaved(saved)
      if (!parsed) return
      // A session still running (another instance of the app has it) would get a second copy,
      // with its hooks and MCP servers, from `claude --resume` (#168). Unknown counts as running.
      const sessions = parsed.worktrees.flatMap((w) => Object.values(w.panes).flatMap((p) => (p.view === 'terminal' && p.sessionId ? [p.sessionId] : [])))
      const running: Set<string> | 'unknown' =
        sessions.length === 0 ? new Set() : await liveSessions(sessions).then((ids) => new Set(ids), () => 'unknown' as const)
      // Open in the saved order, the shown one shown, before any shell spawns.
      set((s) => {
        const opened = parsed.worktrees.flatMap((w) => (w.path !== null && w.path !== s.activeWorktree && !s.worktrees.includes(w.path) ? [w.path] : []))
        const parked = { ...s.parked }
        for (const w of opened) parked[w] = EMPTY_LAYOUT
        return { worktrees: [...s.worktrees, ...opened], parked }
      })
      if (parsed.activeWorktree !== null) swap(parsed.activeWorktree)
      const first = parsed.worktrees.filter((w) => w.path === parsed.activeWorktree)
      for (const w of [...first, ...parsed.worktrees.filter((w) => w.path !== parsed.activeWorktree)]) {
        const made: Tab[] = []
        const named = new Map<string, string>()
        for (const t of w.tabs) {
          const ids = new Map<PaneId, PaneId>()
          for (const old of leaves(t.root)) {
            const p = w.panes[String(old)]
            if (p.view === 'terminal') {
              const cwd = p.cwd ?? w.path ?? undefined
              // Its shell kept running: the pane keeps its id, and the Claude in it runs on.
              const back = await reattach(old, cwd)
              const id = back ? old : await spawnPane(cwd)
              ids.set(old, id)
              if (p.face) get().setFace(id, p.face)
              if (p.sessionId) {
                // Kept on the pane even when not resumed, so the saved layout keeps it too.
                get().setSessionId(id, p.sessionId)
                const resumable = !back && running !== 'unknown' && !running.has(p.sessionId)
                if (id > 0 && resumable) setTimeout(() => void pty.write(id, `claude --resume ${p.sessionId}\n`), PROMPT_DELAY_MS)
              }
            } else {
              const id = synthetic--
              ids.set(old, id)
              set((s) => ({ panes: { ...s.panes, [id]: { id, view: p.view, props: p.props ?? {}, title: p.title } } }))
            }
          }
          const root = mapLeaves(t.root, ids)
          const tab: Tab = {
            id: `tab-${leaves(root)[0]}`,
            root,
            focused: ids.get(t.focused) ?? leaves(root)[0],
            ...(t.name ? { name: t.name } : {}),
            ...(t.preview ? { preview: true } : {}),
          }
          made.push(tab)
          named.set(t.id, tab.id)
        }
        // The layout of no worktree is the one shown only when the file showed no worktree.
        addLayout(w.path === null && parsed.activeWorktree !== null ? ELSEWHERE : w.path, restoredLayout(w, made, named))
      }
    }

    /** Saved layout `w` with its tabs as `made` (named from the saved ids by `named`) and its
     *  groups under new ids; its shown tab the one saved, else the one its active group showed. */
    function restoredLayout(w: SavedLayout, made: Tab[], named: Map<string, string>): WorktreeLayout {
      const renamed = new Map(groupIds(w.groupRoot).map((g) => [g, fresh()]))
      const groups: Record<string, WorktreeLayout['groups'][string]> = {}
      for (const [old, id] of renamed) {
        const g = w.groups[old]
        groups[id] = { id, tabs: g.tabs.flatMap((t) => named.get(t) ?? []), activeTab: named.get(g.activeTab) ?? '' }
      }
      const activeGroup = renamed.get(w.activeGroup) ?? ''
      const activeTab = named.get(w.activeTab) ?? groups[activeGroup]?.activeTab ?? ''
      return tidy({ tabs: made, activeTab, groups, groupRoot: w.groupRoot && mapGroups(w.groupRoot, renamed), activeGroup }, fresh)
    }

    return {
      tabs: [],
      activeTab: '',
      groups: {},
      groupRoot: null,
      activeGroup: '',
      panes: {},
      activeWorktree: null,
      worktrees: [],
      parked: {},
      paletteOpen: false,
      sinks: {},

      async switchWorktree(path) {
        swap(path)
      },

      async closeWorktree(path) {
        const s = get()
        if (!s.worktrees.includes(path)) return
        const shownHere = s.activeWorktree === path
        const tabs = shownHere ? s.tabs : s.parked[path].tabs
        const ids = tabs.flatMap((t) => leaves(t.root))
        // Forgotten before the kills are awaited, so nothing opens into it meanwhile.
        set((s) => {
          const panes = { ...s.panes }
          const sinks = { ...s.sinks }
          for (const p of ids) {
            delete panes[p]
            delete sinks[p]
            pending.delete(p)
            replay.delete(p)
          }
          const parked = { ...s.parked }
          delete parked[path]
          const idx = s.worktrees.indexOf(path)
          const worktrees = s.worktrees.filter((w) => w !== path)
          if (s.activeWorktree !== path) return { panes, sinks, parked, worktrees }
          const next = worktrees[Math.max(0, idx - 1)] ?? null
          const layout = next === null ? EMPTY_LAYOUT : parked[next]
          if (next !== null) delete parked[next]
          memo = layout
          return { panes, sinks, parked, worktrees, activeWorktree: next, ...fields(layout) }
        })
        for (const p of ids) if (p > 0) await pty.kill(p)
      },

      openWorktrees() {
        return get().worktrees
      },

      worktreeTabs(path) {
        const s = get()
        return s.activeWorktree === path ? s.tabs : s.parked[path]?.tabs ?? NO_TABS
      },

      worktreeLayout(path) {
        const s = get()
        return s.activeWorktree !== null && s.activeWorktree === path ? shown(s) : s.parked[path]
      },

      async newTab(cwd) {
        const { activeWorktree: where, activeGroup: group } = get()
        const pane = await spawnPane(cwd ?? where ?? undefined)
        land(where, { id: tabId(pane), root: leaf(pane), focused: pane }, { group })
      },

      showHome() {
        set({ activeTab: '' })
      },

      async openCommandTab(cwd, cmd, sessionId) {
        const { activeWorktree: where, activeGroup: group } = get()
        const pane = await spawnPane(cwd ?? where ?? undefined)
        set((s) => ({ panes: { ...s.panes, [pane]: { ...s.panes[pane], id: pane, sessionId } } }))
        land(where, { id: tabId(pane), root: leaf(pane), focused: pane }, { group })
        if (pane > 0) setTimeout(() => void pty.write(pane, cmd + '\n'), PROMPT_DELAY_MS)
      },

      async split(dir, cwd) {
        const tab = active()
        if (!tab) return
        const s = get()
        cwd = cwd ?? s.panes[tab.focused]?.cwd ?? s.activeWorktree ?? undefined
        const inside = isTerminalTab(tab, s.panes)
        const { activeWorktree: where, activeGroup: group } = s
        const pane = await spawnPane(cwd)
        if (!inside) return land(where, { id: tabId(pane), root: leaf(pane), focused: pane }, { group, side: dir === 'row' ? 'right' : 'down' })
        set((s) =>
          inLayoutOf(s, tab.id, (l) => withTab(l, tab.id, (t) => ({ ...t, root: splitAt(t.root, tab.focused, pane, dir), focused: pane }))),
        )
      },

      async closePane() {
        const tab = active()
        if (!tab) return
        const closing = tab.focused
        if (closing > 0) await pty.kill(closing)
        set((s) => {
          const panes = { ...s.panes }
          delete panes[closing]
          const sinks = { ...s.sinks }
          delete sinks[closing]
          return {
            panes,
            sinks,
            ...inLayoutOf(s, tab.id, (l) => {
              const root = closeLeaf(l.tabs.find((t) => t.id === tab.id)!.root, closing)
              if (root === null) return dropTab(l, tab.id)
              return withTab(l, tab.id, (t) => ({ ...t, root, focused: leaves(root)[0] }))
            }),
          }
        })
      },

      openView(view, props, place, title, opts: OpenOptions = {}) {
        const s = get()
        const l = shown(s)
        const preview = !!opts.preview && view !== 'terminal'
        const shows = showsHandler(view)
        const byId = (id: string) => l.tabs.find((t) => t.id === id)
        const paneOf = (t: Tab) => {
          const same = leaves(t.root).filter((p) => s.panes[p]?.view === view)
          return same.includes(t.focused) ? t.focused : same[0]
        }
        const home = l.groups[l.activeGroup] ? l.activeGroup : undefined
        // The group it lands in, when that group exists already; `side`: beside `home` otherwise.
        let dest = home
        let side: Side | undefined
        if (place === 'split-row' || place === 'split-col') {
          side = place === 'split-row' ? 'right' : 'down'
          dest = home === undefined ? undefined : groupToward(l.groupRoot, home, side)
        } else if (place === 'auto' && shows) dest = targetGroup(l, s.panes, view)

        if (shows) {
          // A document already open is shown, never opened twice in its group: in the group it
          // would land in, then (for `auto`) anywhere in the worktree.
          const scope = place === 'auto' ? [dest, ...groupIds(l.groupRoot).filter((g) => g !== dest)] : [dest]
          for (const g of scope) {
            if (g === undefined) continue
            for (const id of l.groups[g].tabs) {
              const t = byId(id)!
              const p = paneOf(t)
              if (p !== undefined && shows(p, props)) return reveal(t.id, p, preview)
            }
          }
          // A preview takes the place of the one its group has, reused when the view takes it.
          const old = place === 'auto' && preview ? previewIn(l, dest) : undefined
          const p = old && paneOf(old)
          if (old && p !== undefined && reuse(p, view, props, title)) return reveal(old.id, p, true)
        } else if (place === 'auto') {
          // A tab of the view already open takes the new props: the one shown first, then the
          // active group's, then any other group's. Never a split.
          const order = [l.activeTab, ...(home === undefined ? [] : l.groups[home].tabs), ...l.tabs.map((t) => t.id)]
          for (const id of new Set(order)) {
            const t = id ? byId(id) : undefined
            const p = t && paneOf(t)
            if (t && p !== undefined && reuse(p, view, props, title)) return reveal(t.id, p, preview)
          }
        }

        const id = synthetic--
        const tab: Tab = { id: tabId(id), root: leaf(id), focused: id, ...(preview ? { preview: true } : {}) }
        set((s) => {
          const l = shown(s)
          let next = side && dest === undefined && home !== undefined ? putBeside(l, tab, home, side, fresh) : undefined
          const old = next ? undefined : preview ? previewIn(l, dest) : undefined
          const gone = old ? leaves(old.root) : []
          if (!next) next = putTab(l, tab, dest, old && l.groups[dest!].tabs.indexOf(old.id), fresh)
          // The preview it replaces goes, and its views with it.
          if (old) next = dropTab(next, old.id)
          const panes = { ...s.panes, [id]: { id, view, props, title } }
          const sinks = { ...s.sinks }
          for (const p of gone) {
            delete panes[p]
            delete sinks[p]
          }
          return { panes, sinks, ...fields(showTab(next, tab.id)) }
        })
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
          return { panes, sinks, ...inLayoutOf(s, tab.id, (l) => withTab(l, tab.id, (t) => ({ ...t, root: leaf(keep), focused: keep }))) }
        })
      },

      async closeTab(id) {
        const s0 = get()
        const tab = [s0.tabs, ...Object.values(s0.parked).map((l) => l.tabs)].flat().find((t) => t.id === id)
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
          return { panes, sinks, ...inLayoutOf(s, id, (l) => dropTab(l, id)) }
        })
      },

      focusPane(id) {
        set((s) => {
          const t = s.tabs.find((t) => leaves(t.root).includes(id))
          if (!t) return s
          const l = shown(s)
          const next = showTab(withTab(l, t.id, (x) => (x.focused === id ? x : { ...x, focused: id })), t.id)
          return next === l ? s : fields(next)
        })
      },

      goToPane(id) {
        const holds = (tabs: Tab[]) => tabs.some((t) => leaves(t.root).includes(id))
        const away = get().parked[ELSEWHERE]?.tabs.find((t) => holds([t]))
        const other = Object.entries(get().parked).find(([, l]) => holds(l.tabs))?.[0]
        if (away) get().bringTab(away.id)
        else if (other !== undefined) swap(other)
        get().focusPane(id)
      },

      activateTab(id) {
        set((s) => (s.parked[ELSEWHERE]?.tabs.some((t) => t.id === id) ? {} : inLayoutOf(s, id, (l) => showTab(l, id))))
      },

      moveTab(id, to) {
        set((s) => (s.parked[ELSEWHERE]?.tabs.some((t) => t.id === id) ? {} : inLayoutOf(s, id, (l) => moveTabIn(l, id, to, fresh))))
      },

      detachPane(pane, to) {
        set((s) => {
          const l = shown(s)
          const t = l.tabs.find((x) => leaves(x.root).includes(pane))
          const root = t && closeLeaf(t.root, pane)
          if (!t || !root || !l.groups[to.group]) return {}
          const rest = leaves(root)
          const out = withTab(l, t.id, (x) => ({ ...x, root, focused: rest.includes(x.focused) ? x.focused : rest[0] }))
          const tab: Tab = { id: tabId(pane), root: leaf(pane), focused: pane }
          return fields(showTab(putTab(out, tab, to.group, to.index, fresh), tab.id))
        })
      },

      keepTab(id) {
        set((s) => inLayoutOf(s, id, (l) => withTab(l, id, kept)))
      },

      focusGroup(id) {
        set((s) => {
          const g = s.groups[id]
          if (!g || (s.activeGroup === id && s.activeTab === g.activeTab)) return s
          return { activeGroup: id, activeTab: g.activeTab }
        })
      },

      setGroupRatio(path, ratio) {
        set((s) => {
          const root = s.groupRoot && groupRatioAt(s.groupRoot, path, ratio)
          return root === s.groupRoot ? s : { groupRoot: root }
        })
      },

      bringTab(id) {
        set((s) => {
          const away = s.parked[ELSEWHERE]
          const tab = away?.tabs.find((t) => t.id === id)
          if (!tab) return {}
          const parked = { ...s.parked, [ELSEWHERE]: dropTab(away, id) }
          return { parked, ...fields(showTab(putTab(shown(s), tab, undefined, undefined, fresh), id)) }
        })
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
        const id = get().groups[get().activeGroup]?.tabs[index]
        if (id) set((s) => fields(showTab(shown(s), id)))
      },

      cycleTab(delta) {
        const g = get().groups[get().activeGroup]
        if (!g) return
        const i = g.tabs.indexOf(g.activeTab)
        const id = g.tabs[(i + delta + g.tabs.length) % g.tabs.length]
        set((s) => fields(showTab(shown(s), id)))
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
          // Only a terminal joins another tab, and only a tab of terminals: no other tab splits.
          if (!isTerminalTab(dest, s.panes) || !isTerminalTab({ ...src, root: leaf(from) }, s.panes)) return {}
          // Grafted first, and only then extracted: a graft that refuses after the pane has
          // already left its own tree is the one way a move loses a pane for good.
          const joined = graft(dest.root, to, from, side)
          if (joined === dest.root) return {}
          const rest = extract(src.root, from)
          let l = withTab(shown(s), dest.id, (t) => ({ ...t, root: joined, focused: from }))
          if (rest) {
            const kept = leaves(rest)
            l = withTab(l, src.id, (t) => ({ ...t, root: rest, focused: kept.includes(t.focused) ? t.focused : kept[0] }))
          } else {
            // The pane it left was the last one: the tab goes with it rather than staying empty,
            // and the eye follows the pane when that tab was the one looked at.
            const looking = s.activeTab === src.id
            l = dropTab(l, src.id)
            if (looking) l = showTab(l, dest.id)
          }
          return fields(l)
        })
      },

      setSessionId(id, sessionId) {
        set((s) => (s.panes[id] ? { panes: { ...s.panes, [id]: { ...s.panes[id], sessionId } } } : {}))
      },
      setFace(id, face) {
        set((s) => (s.panes[id]?.view === 'terminal' ? { panes: { ...s.panes, [id]: { ...s.panes[id], face } } } : {}))
      },

      // A closed pane's shell still reports its exit (and may print a title) after the kill: a
      // pane that is gone stays gone.
      setCwd(id, cwd) {
        set((s) => (s.panes[id] ? { panes: { ...s.panes, [id]: { ...s.panes[id], id, cwd } } } : {}))
      },
      setTitle(id, title) {
        set((s) => (s.panes[id] ? { panes: { ...s.panes, [id]: { ...s.panes[id], id, title } } } : {}))
      },
      paneExited(id, code) {
        set((s) => (s.panes[id] ? { panes: { ...s.panes, [id]: { ...s.panes[id], id, exitCode: code } } } : {}))
      },
      attachSink(id, sink) {
        set((s) => ({ sinks: { ...s.sinks, [id]: sink } }))
        const chunks = [...(replay.get(id) ?? []), ...(pending.get(id) ?? [])]
        pending.delete(id)
        if (chunks.length) replay.set(id, chunks)
        for (const b of chunks) sink(b)
      },
      setPalette(open) {
        set({ paletteOpen: open })
      },

      snapshotForSave() {
        const s = get()
        const layouts: [string | null, WorktreeLayout][] = s.worktrees.map((w) => [w, w === s.activeWorktree ? shown(s) : s.parked[w]])
        const away = s.parked[ELSEWHERE]
        // With no worktree shown, the file has one layout of no worktree for both kinds of tab.
        if (s.activeWorktree === null && s.tabs.length + (away?.tabs.length ?? 0)) {
          const loose = shown(s)
          layouts.unshift([null, !away?.tabs.length ? loose : loose.tabs.length ? joinTabs(loose, away.tabs, fresh) : away])
        } else if (away?.tabs.length) layouts.push([null, away])
        const worktrees = layouts.map(([path, l]): SavedWorktree => ({ path, ...saveLayout(l, s.panes) }))
        return { version: SAVED_VERSION, activeWorktree: s.activeWorktree, worktrees }
      },

      async restore(saved) {
        const sessions = opts.sessions ?? providedSessions()
        // The terminals that outlived the last page, each claimed at most once by a saved pane.
        const held = sessions ? await sessions.list().catch((): PtyInfo[] => []) : []
        const claimed = new Set<PaneId>()
        /** Saved pane `old` on its own shell again, when that shell still runs. */
        const reattach = async (old: PaneId, cwd: string | undefined) => {
          const info = held.find((i) => i.id === old)
          if (!sessions || !info?.alive || claimed.has(old)) return false
          claimed.add(old)
          return attachPane(sessions, old, info.cwd || cwd)
        }
        try {
          await restoreSaved(saved, reattach)
        } finally {
          if (sessions) await adopt(sessions, held.filter((i) => !claimed.has(i.id)))
        }
      },
    }
  })
}

const NO_TABS: Tab[] = []

/** Whether `folder` is worktree `w` or lies in it (a sibling whose name only starts the same does not). */
function inside(folder: string | undefined, w: string): boolean {
  return !!folder && (folder === w || folder.startsWith(w.endsWith('/') ? w : `${w}/`))
}

/** One layout as the file keeps it: transient views leave their tab, and a tab left with none
 *  goes, from its group too. */
function saveLayout(l: WorktreeLayout, panes: Record<PaneId, Pane>): SavedLayout {
  let rest = l
  const tabs: SavedTab[] = []
  const saved: Record<string, SavedLayout['panes'][string]> = {}
  for (const t of l.tabs) {
    let root: Node | null = t.root
    for (const id of leaves(t.root)) {
      const p = panes[id]
      if (!p || TRANSIENT_VIEWS.has(p.view)) root = root && closeLeaf(root, id)
    }
    if (!root) {
      rest = dropTab(rest, t.id)
      continue
    }
    const ids = leaves(root)
    for (const id of ids) {
      const { view, props, cwd, title, sessionId, face } = panes[id]
      saved[String(id)] = {
        view,
        ...(props === undefined ? {} : { props }),
        ...(cwd ? { cwd } : {}),
        ...(title ? { title } : {}),
        ...(sessionId ? { sessionId } : {}),
        ...(face === 'conversation' ? { face } : {}),
      }
    }
    tabs.push({ id: t.id, root, focused: ids.includes(t.focused) ? t.focused : ids[0], ...(t.name ? { name: t.name } : {}), ...(t.preview ? { preview: true } : {}) })
  }
  return { tabs, panes: saved, activeTab: rest.activeTab, groups: rest.groups, groupRoot: rest.groupRoot, activeGroup: rest.activeGroup }
}

export const useAppStore = <T,>(store: Store, sel: (s: State & Actions) => T) => useStore(store, sel)
