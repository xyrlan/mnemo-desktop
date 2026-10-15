import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type PointerEvent } from 'react'
import { useStore } from 'zustand'
import type { StoreApi } from 'zustand/vanilla'
import { EyeOff, X } from 'lucide-react'
import type { ConversationViewProps } from '../../conversation/ConversationView'
import { STATUS_BAR } from '../../shell/edges'
import type { ChangedFile, DiffClient } from '../../diff/client'
import type { AgentState, RepoNode } from '../../fleet/types'
import type { PaneViewProps } from '../../panes/registry'
import type { SessionHost } from '../../session/host'
import type { Feed, Ship } from '../ship-types'
import { nexusStore, useNexus, type DrawerTab } from '../store'
import { openWindow } from '../ui/windows'
import { Chips, QuickDiff, useChanges, type DiffAsk } from './changes'
import { isToggleKey, toggleLabel } from './keys'
import { contextOf, crumbsOf, findFigure, labelOf, lineOf, spriteOf, stateOf, tokens, type Figure } from './model'
import { viewName, type Drawer } from './sessions'
import { clampWidth, saveWidth, shownWidth } from './width'

/** The Nexus drawer (v2 spec, "Acting from it"): a right-hand panel beside the ship with one tab per
 *  session opened from it. Each tab shows the session's live terminal, through the session host
 *  (the drawer shows terminals only: spec `2026-10-15-nexus-app-design.md`). A session with none to
 *  borrow shows its conversation read-only.
 *
 *  The drawer stays mounted while it has tabs, also collapsed and while the Nexus is closed, hidden
 *  with `display: none`: a terminal view that is hidden that way hands its session to one on screen
 *  and keeps drawing what it is fed, and one shown again takes the session back (`props.active`). */

export type DrawerDeps = {
  drawer: Drawer
  host: SessionHost
  /** The layout store (`src/layout/store.ts`): its owners say whether a tab's view owns its
   *  session. (`panes` is read by nothing since *open as tab* went; wave 2b drops it.) */
  owners: StoreApi<{ owners: Record<number, { name?: string } | undefined>; panes?: Record<number, { offscreen?: true } | undefined> }>
  /** Draws a terminal: the terminal pane view (`src/terminal/view.tsx`) in the app. */
  terminal: ComponentType<PaneViewProps>
  /** Draws a conversation read-only (`src/conversation/ConversationView.tsx` with no agent). */
  conversation: ComponentType<Pick<ConversationViewProps, 'sessionId' | 'cwd'>>
  diff: DiffClient
  /** The deepest worktree the app knows that holds `cwd`. */
  worktreeOf(cwd: string): string
  /** Opens repo `root` in the drawer: a shell there, in a tab of its own (a breadcrumb). */
  goToRepo(root: string): void
  /** The layout's terminal pane running session `sessionId`, if one does. */
  paneOfSession(sessionId: string): number | null
}

export type NexusDrawerProps = {
  deps: DrawerDeps
  /** The ship last built, or null before the first. */
  ship: Ship | null
  feed: Feed | null
  /** The fleet's repos: a robot's breadcrumbs name its own. */
  repos: readonly RepoNode[]
  /** The Nexus is open. */
  shown: boolean
  /** Opens a figure in the drawer (a breadcrumb). */
  onOpen(id: string): void
}

const DOT: Record<AgentState, string> = { working: 'bg-state-working', 'needs-you': 'bg-state-needs-you', done: 'bg-state-done', idle: 'bg-state-idle' }
const TEXT: Record<AgentState, string> = { working: 'text-state-working', 'needs-you': 'text-state-needs-you', done: 'text-state-done', idle: 'text-state-idle' }

/** The drawer's width as drawn: the one dragged, else the default, kept within the window as it
 *  is now. The dragged one is kept, so a window made small and then large again gets it back. */
export function useShownWidth(): number {
  const chosen = useNexus((s) => s.drawerWidth)
  const [vw, setVw] = useState(() => window.innerWidth)
  useEffect(() => {
    const on = () => setVw(window.innerWidth)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return shownWidth(chosen, vw)
}

export function NexusDrawer({ deps, ship, feed, repos, shown, onOpen }: NexusDrawerProps) {
  const tabs = useNexus((s) => s.tabs)
  const activeTab = useNexus((s) => s.activeTab)
  const collapsed = useNexus((s) => s.collapsed)
  const width = useShownWidth()
  const [diff, setDiff] = useState<DiffAsk | null>(null)
  const closeDiff = useCallback(() => setDiff(null), [])
  const root = useRef<HTMLElement>(null)
  const open = shown && tabs.length > 0 && !collapsed
  const active = tabs.find((t) => t.id === activeTab) ?? null
  const activeSession = useStore(deps.host, (h) => (active?.key ? h.sessions[active.key] : undefined))

  // The quick diff belongs to the tab shown in an open drawer.
  useEffect(() => setDiff(null), [activeTab, open])
  // Collapsed, it lets go of the keyboard.
  useEffect(() => {
    if (!open && root.current?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur()
  }, [open])

  // ⌘\ toggles it while the Nexus is open, from anywhere in it, a tab's terminal too. Esc closes the
  // quick diff first; with none open, the view's Esc (`NexusView`) collapses the drawer.
  const diffOpen = diff !== null
  useEffect(() => {
    if (!shown || !tabs.length) return
    const onKey = (e: KeyboardEvent) => {
      if (isToggleKey(e)) deps.drawer.toggle()
      else if (e.key === 'Escape' && diffOpen) setDiff(null)
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [deps.drawer, shown, tabs.length, diffOpen])

  if (!tabs.length) return null
  return (
    <>
      <aside
        ref={root}
        data-ui=""
        data-nexus-drawer=""
        data-session-pty={activeSession?.pty ?? ''}
        aria-label="Sessions"
        className="fixed right-0 z-drawer flex-col border-l border-border bg-card text-card-foreground shadow-[-6px_0_16px_rgba(0,0,0,0.18)]"
        style={{ display: open ? 'flex' : 'none', top: 0, bottom: STATUS_BAR, width }}
      >
        <ResizeEdge width={width} />
        {/* As tall as the ship's bar beside it (`.ship-top`, 44 px): the Nexus takes the whole window
            from the top (#440), and the two bars read as one. */}
        <div role="tablist" className="flex h-11 shrink-0 overflow-x-auto border-b border-border bg-background" data-drawer-tabs="">
          {tabs.map((t) => (
            <TabButton key={t.id} tab={t} active={t.id === activeTab} figure={findFigure(ship, t.id)} deps={deps} />
          ))}
        </div>
        <div className="flex min-h-0 flex-1">
          {tabs.map((t) => (
            <TabPanel
              key={t.id}
              tab={t}
              active={t.id === activeTab}
              shown={open}
              deps={deps}
              ship={ship}
              feed={feed}
              repos={repos}
              onOpen={onOpen}
              picked={diff?.file.path ?? null}
              onPick={(worktree, file, el) => {
                const r = el.getBoundingClientRect()
                setDiff((d) => (d?.file.path === file.path ? null : { worktree, file, anchor: { left: r.left, bottom: r.bottom } }))
              }}
            />
          ))}
        </div>
      </aside>
      {shown && collapsed && (
        <button
          type="button"
          data-drawer-handle=""
          className="fixed right-0 top-[38%] z-drawer rounded-l-md border border-r-0 border-border bg-card px-1.5 py-3 text-xs font-semibold text-card-foreground shadow-md [writing-mode:vertical-rl] hover:bg-accent"
          title={`${toggleLabel()} or click: open the drawer`}
          onClick={() => nexusStore.getState().setCollapsed(false)}
        >
          ⟨ {tabs.length} {tabs.length === 1 ? 'session open' : 'sessions open'} · {toggleLabel()}
        </button>
      )}
      {open && diff && <QuickDiff diff={deps.diff} ask={diff} onClose={closeDiff} />}
    </>
  )
}

/** The left edge: dragged, it draws a guide where the edge will be, and the drawer takes that width
 *  when the drag ends, and keeps it. Resizing as it moves would draw the whole ship again at each
 *  move and resize the drawer's terminals, their programs with them. */
function ResizeEdge({ width }: { width: number }) {
  const drag = useRef<{ pointerId: number; x: number; width: number } | null>(null)
  const [preview, setPreview] = useState<number | null>(null)
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (d?.pointerId !== e.pointerId) return
    setPreview(clampWidth(d.width + d.x - e.clientX))
  }
  const end = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== e.pointerId) return
    drag.current = null
    if (preview !== null && e.type === 'pointerup') {
      nexusStore.getState().setDrawerWidth(preview)
      saveWidth(preview)
    }
    setPreview(null)
  }
  return (
    <>
      {preview !== null && <div data-drawer-resize-guide="" aria-hidden className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-ring" style={{ left: width - preview }} />}
      <div
        data-drawer-resize=""
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the drawer"
        className="absolute inset-y-0 -left-1.5 z-10 w-2.5 cursor-ew-resize"
        onPointerDown={(e) => {
          if (e.button !== 0) return
          e.preventDefault()
          drag.current = { pointerId: e.pointerId, x: e.clientX, width }
          e.currentTarget.setPointerCapture?.(e.pointerId)
        }}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />
    </>
  )
}

function TabButton({ tab, active, figure, deps }: { tab: DrawerTab; active: boolean; figure: Figure | null; deps: DrawerDeps }) {
  const pty = useStore(deps.host, (h) => (tab.key ? (h.sessions[tab.key]?.pty ?? null) : null))
  const owner = useStore(deps.owners, (s) => (pty === null ? undefined : s.owners[pty]?.name))
  const elsewhere = pty !== null && owner !== viewName(tab.id)
  const state = figure ? stateOf(figure) : null
  const label = figure ? labelOf(figure) : tab.label
  const sprite = figure ? spriteOf(figure) : null
  return (
    <div
      role="tab"
      aria-selected={active}
      data-drawer-tab={tab.id}
      tabIndex={active ? 0 : -1}
      className={`flex shrink-0 cursor-pointer items-center gap-1.5 border-r border-border py-0.5 pr-1 pl-1.5 text-xs font-semibold whitespace-nowrap ${active ? 'bg-card text-foreground shadow-[inset_0_-2px_0_var(--ring)]' : 'text-muted-foreground hover:text-foreground'}`}
      onClick={() => nexusStore.getState().activateTab(tab.id)}
    >
      <span className={`size-2 shrink-0 rounded-full ${state ? DOT[state.tone] : 'bg-state-idle'}`} role="img" aria-label={state?.text ?? 'gone from the ship'} />
      {sprite && <img src={sprite.src} alt="" width={24} height={24} className="shrink-0 [image-rendering:pixelated]" />}
      <span>{label}</span>
      {elsewhere && (
        <span data-drawer-elsewhere="" title="Shown in another view, which types into it: open the tab's terminal to take it back">
          <EyeOff className="size-3 text-muted-foreground" aria-label="Shown in another view" />
        </span>
      )}
      <button
        type="button"
        aria-label={`Close ${label}`}
        className="rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        onClick={(e) => {
          e.stopPropagation()
          void deps.drawer.close(tab.id)
        }}
      >
        <X className="size-3" />
      </button>
    </div>
  )
}

type PanelProps = {
  tab: DrawerTab
  active: boolean
  /** The drawer is on screen. */
  shown: boolean
  deps: DrawerDeps
  ship: Ship | null
  feed: Feed | null
  repos: readonly RepoNode[]
  onOpen(id: string): void
  picked: string | null
  onPick(worktree: string, file: ChangedFile, el: HTMLElement): void
}

function TabPanel({ tab, active, shown, deps, ship, feed, repos, onOpen, picked, onPick }: PanelProps) {
  const session = useStore(deps.host, (h) => (tab.key ? h.sessions[tab.key] : undefined))
  const pty = session?.pty ?? null
  const figure = findFigure(ship, tab.id)
  const cwd = (figure && (figure.kind === 'robot' ? figure.robot.child.cwd : figure.captain.parent?.cwd)) ?? tab.cwd
  const worktree = useMemo(() => (cwd ? deps.worktreeOf(cwd) : null), [cwd, deps])
  const changes = useChanges(deps.diff, worktree, active && shown)
  const panel = useRef<HTMLDivElement>(null)
  const Terminal = deps.terminal
  const Conversation = deps.conversation
  const close = useCallback(() => void deps.drawer.close(tab.id), [deps.drawer, tab.id])
  // A presentation's view under the tab's own name; shown again, it takes the session back.
  const props = useMemo(() => ({ present: true, name: viewName(tab.id), close, active: active && shown }), [tab.id, close, active, shown])

  // Shown, it takes the keyboard: its terminal.
  useEffect(() => {
    if (!active || !shown || pty === null) return
    const frame = requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>('[data-drawer-terminal] textarea')?.focus())
    return () => cancelAnimationFrame(frame)
  }, [active, shown, pty])

  return (
    // Focusable, so a click anywhere in it gives the drawer the keyboard.
    <div ref={panel} role="tabpanel" tabIndex={-1} data-drawer-panel={tab.id} className="min-h-0 min-w-0 flex-1 flex-col outline-none" style={{ display: active ? 'flex' : 'none' }}>
      <Header tab={tab} figure={figure} ship={ship} feed={feed} repos={repos} deps={deps} onOpen={onOpen} />
      {worktree && <Chips list={changes.list} error={changes.error} picked={picked} onPick={(f, el) => onPick(worktree, f, el)} />}
      <div className="relative min-h-0 flex-1 overflow-hidden border-t border-border bg-background">
        {tab.key === null ? (
          <div className="flex h-full flex-col" data-drawer-readonly="">
            <p className="shrink-0 border-b border-border bg-muted px-3 py-1.5 text-xs text-muted-foreground">{tab.readOnly}</p>
            <div className="flex min-h-0 flex-1 flex-col">
              {tab.sessionId && tab.cwd ? (
                <Conversation sessionId={tab.sessionId} cwd={tab.cwd} />
              ) : (
                <p className="p-4 text-center text-sm text-muted-foreground">No transcript is known for this session.</p>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="h-full pt-1 pl-2" data-drawer-terminal="">
              {pty !== null && <Terminal id={pty} props={props} />}
            </div>
            {session?.error && <p className="absolute inset-0 flex items-center justify-center bg-background p-4 text-center text-sm text-muted-foreground">{session.error}</p>}
            {pty === null && !session?.error && <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">Attaching…</div>}
          </>
        )}
      </div>
    </div>
  )
}

type HeaderProps = {
  tab: DrawerTab
  figure: Figure | null
  ship: Ship | null
  feed: Feed | null
  repos: readonly RepoNode[]
  deps: DrawerDeps
  onOpen(id: string): void
}

const SMALL = 'shrink-0 rounded-sm border border-border px-1.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground'

/** A robot's *Changes*: the full diff of its worktree, in the ship's Changes window. */
function ChangesButton({ id, worktree, label }: { id: string; worktree: string; label: string }) {
  return (
    <button type="button" data-drawer-full-diff="" className={SMALL} title="The full diff of its worktree" onClick={() => openWindow('changes', { robotId: id, worktree, label })}>
      Changes
    </button>
  )
}

function Header({ tab, figure, ship, feed, repos, deps, onOpen }: HeaderProps) {
  if (!figure)
    return (
      <div className="flex shrink-0 items-center gap-2 px-3 py-1.5 text-xs">
        <b className="min-w-0 flex-1 truncate">{tab.label}</b>
        <span className="truncate text-muted-foreground">{tab.key === null ? 'no longer on the ship' : tab.kind === 'session' ? (tab.cwd ?? '') : 'not on the ship yet'}</span>
        {tab.kind === 'robot' && tab.cwd && <ChangesButton id={tab.id} worktree={tab.cwd} label={tab.label} />}
      </div>
    )
  const state = stateOf(figure)
  const context = contextOf(figure, feed)
  const line = lineOf(figure)
  const child = figure.kind === 'robot' ? figure.robot.child : null
  return (
    <div className="shrink-0">
      <div className="flex items-center gap-2 px-3 py-1.5 text-xs">
        <nav aria-label="Breadcrumbs" className="min-w-0 flex-1 truncate text-muted-foreground" data-drawer-crumbs="">
          {crumbsOf(figure, ship, repos).map((c, i) => (
            <span key={i}>
              {i > 0 && <span className="mx-1 opacity-60">▸</span>}
              {c.here ? (
                <b className="text-foreground">{c.text}</b>
              ) : c.go || c.repo ? (
                <button
                  type="button"
                  className="text-foreground/80 hover:underline"
                  title={c.go ? `Open ${c.text} in the drawer` : `Open a terminal in ${c.text}`}
                  onClick={() => (c.go ? onOpen(c.go) : deps.goToRepo(c.repo!))}
                >
                  {c.text}
                </button>
              ) : (
                <span>{c.text}</span>
              )}
            </span>
          ))}
        </nav>
        {context !== null && <span className="shrink-0 text-muted-foreground">context {tokens(context)}</span>}
        <span className={`shrink-0 rounded-sm border border-current px-1.5 text-[11px] font-semibold ${TEXT[state.tone]}`} data-drawer-state="">
          {state.text}
        </span>
        {child && <ChangesButton id={figure.kind === 'robot' ? figure.robot.id : tab.id} worktree={child.cwd} label={labelOf(figure)} />}
      </div>
      {line && <div className="truncate px-3 pb-1 text-[11px] text-muted-foreground" title={line}>{line}</div>}
    </div>
  )
}
