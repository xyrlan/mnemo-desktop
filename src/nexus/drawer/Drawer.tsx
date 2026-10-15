import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type PointerEvent } from 'react'
import { useStore } from 'zustand'
import type { StoreApi } from 'zustand/vanilla'
import { EyeOff, MessageSquare, SquareTerminal, X } from 'lucide-react'
import { shortcutLabel } from '../../actions/chords'
import type { ChatAgent } from '../../conversation/agent'
import type { ConversationViewProps } from '../../conversation/ConversationView'
import { STATUS_BAR, TOP_CHROME } from '../../shell/edges'
import type { ChangedFile, DiffClient } from '../../diff/client'
import type { AgentState, RepoNode } from '../../fleet/types'
import type { PaneViewProps } from '../../panes/registry'
import type { HostedSession, SessionHost } from '../../session/host'
import type { Feed, Ship } from '../ship-types'
import { faceOf, nexusStore, useNexus, type DrawerFace, type DrawerTab } from '../store'
import { statusOf } from './agent'
import { Chips, QuickDiff, useChanges, type DiffAsk } from './changes'
import { isToggleKey, toggleLabel } from './keys'
import { contextOf, crumbsOf, findFigure, labelOf, lineOf, sessionIdOf, spriteOf, stateOf, tokens, type Figure } from './model'
import { viewName, type Drawer } from './sessions'
import { clampWidth, saveWidth, shownWidth } from './width'

/** The Nexus drawer (v2 spec, "Acting from it"): a right-hand panel beside the ship with one tab per
 *  session opened from it. Each tab shows the session's conversation (#437), with a composer that
 *  types into the session's real terminal, drawn underneath through the session host; ⌘⇧C or the
 *  header's switch shows that terminal instead. A session with none to borrow shows its
 *  conversation read-only.
 *
 *  What the session waits on is never behind the conversation: its foot shows the card that
 *  answers a permission or a question, typed into the same terminal, and for anything else (a
 *  dialog, a prompt the transcript has not written yet) an *Open terminal* line in place of the
 *  composer, which would answer it blind.
 *
 *  The drawer stays mounted while it has tabs, also collapsed and while the Nexus is closed, hidden
 *  with `display: none`: a terminal view that is hidden that way hands its session to one on screen
 *  and keeps drawing what it is fed, and one shown again takes the session back (`props.active`). */

export type DrawerDeps = {
  drawer: Drawer
  host: SessionHost
  /** The layout store (`src/layout/store.ts`): its owners say whether a tab's view owns its
   *  session; its panes, which session a pane's Claude runs now (it changes on a `/clear`). */
  owners: StoreApi<{ owners: Record<number, { name?: string } | undefined>; panes?: Record<number, { sessionId?: string } | undefined> }>
  /** Draws a terminal: the terminal pane view (`src/terminal/view.tsx`) in the app. */
  terminal: ComponentType<PaneViewProps>
  /** Draws a conversation (`src/conversation/ConversationView.tsx`): read-only with no agent. */
  conversation: ComponentType<Pick<ConversationViewProps, 'sessionId' | 'cwd' | 'status' | 'agent' | 'onOpenTerminal'>>
  /** How a session's conversation types into its terminal (`./agent`). Without it, the
   *  conversation only reads. */
  agent?(session: Pick<HostedSession, 'kind' | 'pty' | 'error'>): ChatAgent | undefined
  diff: DiffClient
  /** The deepest worktree the app knows that holds `cwd`. */
  worktreeOf(cwd: string): string
  /** Shows repo `root` in the workbench. */
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
        style={{ display: open ? 'flex' : 'none', top: TOP_CHROME, bottom: STATUS_BAR, width }}
      >
        <ResizeEdge width={width} />
        <div role="tablist" className="flex shrink-0 overflow-x-auto border-b border-border bg-background" data-drawer-tabs="">
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
  const face = useNexus((s) => faceOf(s, tab.id))
  const figure = findFigure(ship, tab.id)
  const cwd = (figure && (figure.kind === 'robot' ? figure.robot.child.cwd : figure.captain.parent?.cwd)) ?? tab.cwd
  const worktree = useMemo(() => (cwd ? deps.worktreeOf(cwd) : null), [cwd, deps])
  const changes = useChanges(deps.diff, worktree, active && shown)
  const panel = useRef<HTMLDivElement>(null)
  const Terminal = deps.terminal
  const Conversation = deps.conversation
  const close = useCallback(() => void deps.drawer.close(tab.id), [deps.drawer, tab.id])
  // A presentation's view under the tab's own name; shown again, it takes the session back. It is
  // the same under the conversation as on its own: a flip remounts nothing and moves no ownership.
  const props = useMemo(() => ({ present: true, name: viewName(tab.id), close, active: active && shown }), [tab.id, close, active, shown])

  // The conversation: a pane's Claude, as the pane says now (a `/clear` starts another session);
  // else the figure's, else what the tab knew as it opened.
  const paneSession = useStore(deps.owners, (s) => (session?.kind === 'pane' && pty !== null ? s.panes?.[pty]?.sessionId : undefined))
  const sessionId = paneSession ?? (figure && sessionIdOf(figure)) ?? tab.sessionId
  const kind = session?.kind
  const error = session?.error
  const agent = useMemo(() => (kind && pty !== null ? deps.agent?.({ kind, pty, error }) : undefined), [deps, kind, pty, error])
  // Every ship built carries new figures: the status changes only when what it says does.
  const s = statusOf(figure)
  const status = useMemo(() => s, [s?.busy, s?.waiting, s?.parked]) // eslint-disable-line react-hooks/exhaustive-deps
  const openTerminal = useCallback(() => nexusStore.getState().setFace(tab.id, 'terminal'), [tab.id])

  // Shown, it takes the keyboard: the composer, or the terminal.
  useEffect(() => {
    if (!active || !shown || pty === null) return
    const where = face === 'conversation' ? '[data-drawer-conversation]' : '[data-drawer-terminal]'
    const frame = requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>(`${where} textarea`)?.focus())
    return () => cancelAnimationFrame(frame)
  }, [active, shown, pty, face])

  return (
    // Focusable, so a click anywhere in it gives the drawer the keyboard, ⌘⇧C with it.
    <div ref={panel} role="tabpanel" tabIndex={-1} data-drawer-panel={tab.id} data-drawer-face={tab.key === null ? undefined : face} className="min-h-0 min-w-0 flex-1 flex-col outline-none" style={{ display: active ? 'flex' : 'none' }}>
      <Header tab={tab} figure={figure} ship={ship} feed={feed} repos={repos} deps={deps} onOpen={onOpen} face={tab.key === null ? null : face} />
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
            {/* Laid out under the conversation too, at its own size, so its program never notices
                a flip; isolated, so its canvas never paints over the conversation. */}
            <div className="isolate h-full pt-1 pl-2" data-drawer-terminal="">
              {pty !== null && <Terminal id={pty} props={props} />}
            </div>
            {/* Hidden, not unmounted, while the terminal shows: it keeps its place and its draft. */}
            <div
              className="absolute inset-0 z-10 flex flex-col bg-background"
              data-drawer-conversation=""
              aria-hidden={face !== 'conversation'}
              style={{ visibility: face === 'conversation' ? 'visible' : 'hidden' }}
            >
              {sessionId && cwd ? (
                <Conversation sessionId={sessionId} cwd={cwd} status={status} agent={agent} onOpenTerminal={openTerminal} />
              ) : (
                <p className="p-4 text-center text-sm text-muted-foreground">No transcript is known for this session yet: its terminal is one switch away.</p>
              )}
            </div>
            {error && <p className="absolute inset-0 z-20 flex items-center justify-center bg-background p-4 text-center text-sm text-muted-foreground">{error}</p>}
            {pty === null && !error && face === 'terminal' && <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">Attaching…</div>}
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
  /** How the tab shows its live session; null when it has none (read-only). */
  face: DrawerFace | null
}

const FACES: { face: DrawerFace; label: string; Icon: typeof MessageSquare }[] = [
  { face: 'conversation', label: 'Conversation', Icon: MessageSquare },
  { face: 'terminal', label: 'Terminal', Icon: SquareTerminal },
]

/** *Conversation · Terminal*: how the tab shows its session. */
function FaceSwitch({ tab, face }: { tab: DrawerTab; face: DrawerFace }) {
  const chord = shortcutLabel('pane.toggle-face')
  return (
    <div role="group" aria-label="Show the session as" className="flex shrink-0 rounded-sm border border-border p-px" data-drawer-face-switch="">
      {FACES.map(({ face: f, label, Icon }) => (
        <button
          key={f}
          type="button"
          aria-pressed={face === f}
          data-face={f}
          title={chord ? `${label} (${chord} flips)` : label}
          className={`flex items-center gap-1 rounded-[3px] px-1.5 text-[11px] ${face === f ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          onClick={() => nexusStore.getState().setFace(tab.id, f)}
        >
          <Icon className="size-3" aria-hidden />
          {label}
        </button>
      ))}
    </div>
  )
}

function Header({ tab, figure, ship, feed, repos, deps, onOpen, face }: HeaderProps) {
  const kind = useStore(deps.host, (h) => (tab.key ? h.sessions[tab.key]?.kind : undefined))
  if (!figure)
    return (
      <div className="flex shrink-0 items-center gap-2 px-3 py-1.5 text-xs">
        <b className="min-w-0 flex-1 truncate">{tab.label}</b>
        <span className="text-muted-foreground">no longer on the ship</span>
        {face && <FaceSwitch tab={tab} face={face} />}
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
                  title={c.go ? `Open ${c.text} in the drawer` : `Show ${c.text} in the workbench`}
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
        {face && <FaceSwitch tab={tab} face={face} />}
        {(kind === 'pane' || kind === 'attach') && (
          <button
            type="button"
            data-open-as-tab=""
            className="shrink-0 rounded-sm border border-border px-1.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
            title={kind === 'pane' ? 'Show its pane in the workbench' : 'Attach it in a workbench tab instead'}
            onClick={() => void deps.drawer.reveal(tab.id, child)}
          >
            open as tab ⤢
          </button>
        )}
      </div>
      {line && <div className="truncate px-3 pb-1 text-[11px] text-muted-foreground" title={line}>{line}</div>}
    </div>
  )
}
