import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type PointerEvent } from 'react'
import { useStore } from 'zustand'
import type { StoreApi } from 'zustand/vanilla'
import { EyeOff, X } from 'lucide-react'
import type { ConversationViewProps } from '../../conversation/ConversationView'
import type { ChangedFile, DiffClient } from '../../diff/client'
import type { AgentState, RepoNode } from '../../fleet/types'
import type { PaneViewProps } from '../../panes/registry'
import type { SessionHost } from '../../session/host'
import type { Feed, Ship } from '../ship-types'
import { nexusStore, useNexus, type DrawerTab } from '../store'
import { NexusMenu } from '../ui/Menu'
import { openWindow } from '../ui/windows'
import { Chips, QuickDiff, useChanges, type DiffAsk } from './changes'
import { isToggleKey, toggleLabel } from './keys'
import { contextOf, crumbsOf, findFigure, labelOf, lineOf, stateOf, tokens, type Figure } from './model'
import { fitPills, pillOf } from './pills'
import { viewName, type Drawer } from './sessions'
import { clampWidth, saveWidth, shownWidth } from './width'
import './drawer.css'

/** The Nexus drawer (v2 spec, "Acting from it"): a right-hand panel beside the ship with one tab per
 *  session opened from it. Each tab shows the session's live terminal, through the session host
 *  (the drawer shows terminals only: spec `2026-10-15-nexus-app-design.md`). A session with none to
 *  borrow shows its conversation read-only.
 *
 *  The drawer stays mounted while it has tabs, also collapsed, hidden with `display: none`: a terminal view that is hidden that way hands its session to one on screen
 *  and keeps drawing what it is fed, and one shown again takes the session back (`props.active`). */

export type DrawerDeps = {
  drawer: Drawer
  host: SessionHost
  /** The layout store (`src/layout/store.ts`): its owners say whether a tab's view owns its
   *  session. */
  owners: StoreApi<{ owners: Record<number, { name?: string } | undefined> }>
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
  /** Opens a figure in the drawer (a breadcrumb). */
  onOpen(id: string): void
}

const DOT: Record<AgentState, string> = { working: 'bg-state-working', 'needs-you': 'bg-state-needs-you', done: 'bg-state-done', idle: 'bg-state-idle' }

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

export function NexusDrawer({ deps, ship, feed, repos, onOpen }: NexusDrawerProps) {
  const tabs = useNexus((s) => s.tabs)
  const activeTab = useNexus((s) => s.activeTab)
  const collapsed = useNexus((s) => s.collapsed)
  const width = useShownWidth()
  const [diff, setDiff] = useState<DiffAsk | null>(null)
  const closeDiff = useCallback(() => setDiff(null), [])
  const root = useRef<HTMLElement>(null)
  /** The tab a pill's ←/→ showed: its panel leaves the keyboard on the pills. */
  const keyed = useRef<string | null>(null)
  const open = tabs.length > 0 && !collapsed
  const active = tabs.find((t) => t.id === activeTab) ?? null
  const activeSession = useStore(deps.host, (h) => (active?.key ? h.sessions[active.key] : undefined))

  // The quick diff belongs to the tab shown in an open drawer.
  useEffect(() => setDiff(null), [activeTab, open])
  // Collapsed, it lets go of the keyboard.
  useEffect(() => {
    if (!open && root.current?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur()
  }, [open])

  // ⌘\ toggles it from anywhere in the Nexus, a tab's terminal too. Esc closes the
  // quick diff first; with none open, the view's Esc (`NexusView`) collapses the drawer.
  const diffOpen = diff !== null
  useEffect(() => {
    if (!tabs.length) return
    const onKey = (e: KeyboardEvent) => {
      if (isToggleKey(e)) deps.drawer.toggle()
      else if (e.key === 'Escape' && diffOpen) setDiff(null)
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [deps.drawer, tabs.length, diffOpen])

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
        style={{ display: open ? 'flex' : 'none', top: 0, bottom: 0, width }}
      >
        <ResizeEdge width={width} />
        <DrawerHead tabs={tabs} activeTab={activeTab} active={active} ship={ship} feed={feed} repos={repos} deps={deps} onOpen={onOpen} keyed={keyed} />
        <div className="flex min-h-0 flex-1">
          {tabs.map((t) => (
            <TabPanel
              key={t.id}
              tab={t}
              active={t.id === activeTab}
              shown={open}
              deps={deps}
              ship={ship}
              keyed={keyed}
              picked={diff?.file.path ?? null}
              onPick={(worktree, file, el) => {
                const r = el.getBoundingClientRect()
                setDiff((d) => (d?.file.path === file.path ? null : { worktree, file, anchor: { left: r.left, bottom: r.bottom } }))
              }}
            />
          ))}
        </div>
      </aside>
      {collapsed && (
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

type PanelProps = {
  tab: DrawerTab
  active: boolean
  /** The drawer is on screen. */
  shown: boolean
  deps: DrawerDeps
  ship: Ship | null
  keyed: { current: string | null }
  picked: string | null
  onPick(worktree: string, file: ChangedFile, el: HTMLElement): void
}

function TabPanel({ tab, active, shown, deps, ship, keyed, picked, onPick }: PanelProps) {
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

  // Shown, it takes the keyboard: its terminal. Shown by a pill's ←/→, it leaves it on the pills.
  useEffect(() => {
    if (!active || !shown) return
    if (keyed.current === tab.id) return void (keyed.current = null)
    if (pty === null) return
    const frame = requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>('[data-drawer-terminal] textarea')?.focus())
    return () => cancelAnimationFrame(frame)
  }, [active, shown, pty, keyed, tab.id])

  return (
    // Focusable, so a click anywhere in it gives the drawer the keyboard.
    <div ref={panel} role="tabpanel" tabIndex={-1} data-drawer-panel={tab.id} className="min-h-0 min-w-0 flex-1 flex-col outline-none" style={{ display: active ? 'flex' : 'none' }}>
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

type HeadProps = {
  tabs: DrawerTab[]
  activeTab: string | null
  active: DrawerTab | null
  ship: Ship | null
  feed: Feed | null
  repos: readonly RepoNode[]
  deps: DrawerDeps
  onOpen(id: string): void
  keyed: { current: string | null }
}

type Fit = { order: string[]; shown: number }
const sameFit = (a: Fit | null, b: Fit) => !!a && a.shown === b.shown && a.order.join('\n') === b.order.join('\n')

/** The drawer's one header (#467): a pill per tab, wrapping to two rows at most, then `+N` for the
 *  rest (a menu); under them the shown session's line. The pills are tabs: click or ←/→ shows one,
 *  a middle click or × closes it. */
function DrawerHead({ tabs, activeTab, active, ship, feed, repos, deps, onOpen, keyed }: HeadProps) {
  const strip = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState<Fit | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  // The menu closes on the mousedown of the click that would open it again.
  const closedAt = useRef(0)
  const [, setTick] = useState(0)
  const ids = tabs.map((t) => t.id)
  // A fit for other tabs than these is stale: all of them are drawn until the next one.
  const valid = fit && fit.order.length === ids.length && ids.every((id) => fit.order.includes(id)) ? fit : null
  const order = valid ? valid.order : ids
  const shown = valid ? valid.shown : ids.length
  const byId = new Map(tabs.map((t) => [t.id, t]))
  const hidden = order.slice(shown)

  // What fits is worked out from the pills' own widths, as `flex-wrap` lays them: a pill past two
  // rows is out of the flow but measured still. The strip's width changes with the drawer's.
  useLayoutEffect(() => {
    const el = strip.current
    if (!el) return
    const css = getComputedStyle(el)
    const room = el.clientWidth - parseFloat(css.paddingLeft || '0') - parseFloat(css.paddingRight || '0')
    const gap = parseFloat(css.columnGap) || 0
    if (!(room > 0)) return
    const widths = new Map([...el.querySelectorAll<HTMLElement>('[data-drawer-tab]')].map((p) => [p.dataset.drawerTab!, p.getBoundingClientRect().width]))
    const moreEl = el.querySelector<HTMLElement>('[data-drawer-more]')
    const moreW = moreEl?.getBoundingClientRect().width ?? 0
    const digits = String(Math.max(1, hidden.length)).length
    const more = (n: number) => (moreW || 26) + 7 * Math.max(0, String(n).length - digits)
    const next = fitPills(ids, (id) => widths.get(id) ?? 0, more, room, gap, activeTab)
    if (!sameFit(fit, next)) setFit(next)
  })
  // Measured again when the strip or a pill changes size: the drawer resized, the font loaded, a
  // name changed. Each is observed once, as it comes.
  const watch = useRef<{ ro: ResizeObserver; seen: WeakSet<Element> } | null>(null)
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return
    const w = (watch.current = { ro: new ResizeObserver(() => setTick((t) => t + 1)), seen: new WeakSet() })
    return () => {
      w.ro.disconnect()
      watch.current = null
    }
  }, [])
  useEffect(() => {
    const w = watch.current
    const el = strip.current
    if (!w || !el) return
    for (const e of [el, ...el.querySelectorAll('[data-drawer-tab], [data-drawer-more]')]) {
      if (w.seen.has(e)) continue
      w.seen.add(e)
      w.ro.observe(e)
    }
  })
  // The menu lists the pills not drawn: none, it closes.
  useEffect(() => {
    if (!hidden.length) setMenu(null)
  }, [hidden.length])

  // ←/→ keep the keyboard on the pills: the pill shown takes it.
  const focusTo = useRef<string | null>(null)
  useEffect(() => {
    const id = focusTo.current
    if (id === null || id !== activeTab) return
    focusTo.current = null
    ;[...(strip.current?.querySelectorAll<HTMLElement>('[data-drawer-tab]') ?? [])].find((p) => p.dataset.drawerTab === id)?.focus()
  })
  const step = (id: string, key: string) => {
    const i = order.indexOf(id)
    const to = key === 'Home' ? 0 : key === 'End' ? order.length - 1 : (i + (key === 'ArrowRight' ? 1 : -1) + order.length) % order.length
    const next = order[to]
    if (next === undefined || next === id) return
    keyed.current = next
    focusTo.current = next
    nexusStore.getState().activateTab(next)
  }

  return (
    <header className="nx dw-head" data-drawer-head="">
      <div ref={strip} className="dw-pills">
        <div role="tablist" aria-label="Sessions open" className="dw-tabs" data-drawer-tabs="">
          {order.map((id, i) => {
            const t = byId.get(id)!
            return <Pill key={id} tab={t} active={id === activeTab} figure={findFigure(ship, id)} repos={repos} deps={deps} overflow={i >= shown} keyed={keyed} onStep={step} />
          })}
        </div>
        <button
          type="button"
          className="dw-pill dw-more"
          data-drawer-more=""
          data-overflow={hidden.length ? undefined : ''}
          aria-haspopup="menu"
          aria-expanded={menu !== null}
          tabIndex={hidden.length ? 0 : -1}
          title={`${hidden.length} more ${hidden.length === 1 ? 'session' : 'sessions'}`}
          onClick={(e) => {
            if (performance.now() - closedAt.current < 300) return
            const r = e.currentTarget.getBoundingClientRect()
            setMenu({ x: r.left, y: r.bottom + 4 })
          }}
        >
          +{Math.max(1, hidden.length)}
        </button>
      </div>
      {active && <SessionLine tab={active} figure={findFigure(ship, active.id)} ship={ship} feed={feed} repos={repos} deps={deps} onOpen={onOpen} />}
      {menu && hidden.length > 0 && (
        <NexusMenu
          x={menu.x}
          y={menu.y}
          head={`${hidden.length} more ${hidden.length === 1 ? 'session' : 'sessions'}`}
          items={hidden.map((id) => {
            const t = byId.get(id)!
            const f = findFigure(ship, id)
            return { id, label: pillOf(t, f, repos).full, hint: f ? stateOf(f).text : undefined, run: () => nexusStore.getState().activateTab(id) }
          })}
          onClose={() => {
            closedAt.current = performance.now()
            setMenu(null)
          }}
        />
      )}
    </header>
  )
}

type PillProps = {
  tab: DrawerTab
  active: boolean
  figure: Figure | null
  repos: readonly RepoNode[]
  deps: DrawerDeps
  /** Past two rows: not drawn, in the `+N` menu. */
  overflow: boolean
  keyed: { current: string | null }
  onStep(id: string, key: string): void
}

/** A session's pill: its state dot (× in its place on hover), what it is in a word or two, and an
 *  eye when another view shows its terminal. Its whole name is on hover. */
function Pill({ tab, active, figure, repos, deps, overflow, keyed, onStep }: PillProps) {
  const pty = useStore(deps.host, (h) => (tab.key ? (h.sessions[tab.key]?.pty ?? null) : null))
  const owner = useStore(deps.owners, (s) => (pty === null ? undefined : s.owners[pty]?.name))
  const elsewhere = pty !== null && owner !== viewName(tab.id)
  const state = figure ? stateOf(figure) : null
  const label = figure ? labelOf(figure) : tab.label
  const { text, full } = pillOf(tab, figure, repos)
  // A shell is never on the ship: where it runs says what it is.
  const status = state?.text ?? (tab.kind === 'session' ? (tab.cwd ?? 'a terminal') : tab.key === null ? 'no longer on the ship' : 'not on the ship yet')
  const close = () => void deps.drawer.close(tab.id)
  return (
    <div
      role="tab"
      aria-selected={active}
      data-drawer-tab={tab.id}
      data-tone={state?.tone ?? 'gone'}
      data-overflow={overflow ? '' : undefined}
      tabIndex={active ? 0 : -1}
      className="dw-pill"
      title={`${full} · ${status}`}
      onClick={() => {
        keyed.current = null
        nexusStore.getState().activateTab(tab.id)
      }}
      // A middle click closes it, as a browser's tab; its mousedown would start the autoscroll.
      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
      onAuxClick={(e) => {
        if (e.button !== 1) return
        e.preventDefault()
        close()
      }}
      onKeyDown={(e) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) || e.target !== e.currentTarget) return
        e.preventDefault()
        onStep(tab.id, e.key)
      }}
    >
      <span className="dw-mark">
        <span className={`dw-dot ${state ? DOT[state.tone] : 'bg-state-idle'}`} role="img" aria-label={state?.text ?? (tab.kind === 'session' ? 'a terminal' : 'gone from the ship')} />
        <button
          type="button"
          className="dw-x"
          tabIndex={-1}
          aria-label={`Close ${label}`}
          onClick={(e) => {
            e.stopPropagation()
            close()
          }}
        >
          <X className="size-2.5" strokeWidth={3} />
        </button>
      </span>
      <span data-drawer-tab-label="">{text}</span>
      {elsewhere && (
        <span className="dw-eye" data-drawer-elsewhere="" title="Shown in another view, which types into it: open the tab's terminal to take it back">
          <EyeOff className="size-3" aria-label="Shown in another view" />
        </span>
      )}
    </div>
  )
}

type LineProps = {
  tab: DrawerTab
  figure: Figure | null
  ship: Ship | null
  feed: Feed | null
  repos: readonly RepoNode[]
  deps: DrawerDeps
  onOpen(id: string): void
}

/** A robot's *Changes*: the full diff of its worktree, in the ship's Changes window. */
function ChangesButton({ id, worktree, label }: { id: string; worktree: string; label: string }) {
  return (
    <button type="button" data-drawer-full-diff="" className="dw-small" title="The full diff of its worktree" onClick={() => openWindow('changes', { robotId: id, worktree, label })}>
      Changes
    </button>
  )
}

/** The shown session, said once, under the pills: repo ▸ … ▸ its whole name, its context, its
 *  state and *Changes*; then what it is doing. */
function SessionLine({ tab, figure, ship, feed, repos, deps, onOpen }: LineProps) {
  if (!figure)
    return (
      <div className="dw-line" data-drawer-line={tab.id}>
        <div className="dw-line-row">
          <b className="dw-crumbs" data-drawer-name="" title={tab.label}>
            {tab.label}
          </b>
          <span className="dw-where">{tab.key === null ? 'no longer on the ship' : tab.kind === 'session' ? (tab.cwd ?? '') : 'not on the ship yet'}</span>
          {tab.kind === 'robot' && tab.cwd && <ChangesButton id={tab.id} worktree={tab.cwd} label={tab.label} />}
        </div>
      </div>
    )
  const state = stateOf(figure)
  const context = contextOf(figure, feed)
  const line = lineOf(figure)
  const child = figure.kind === 'robot' ? figure.robot.child : null
  const crumbs = crumbsOf(figure, ship, repos)
  return (
    <div className="dw-line" data-drawer-line={tab.id}>
      <div className="dw-line-row">
        <nav aria-label="Breadcrumbs" className="dw-crumbs" data-drawer-crumbs="" title={crumbs.map((c) => c.text).join(' ▸ ')}>
          {crumbs.map((c, i) => (
            <span key={i}>
              {i > 0 && <span className="dw-sep">▸</span>}
              {c.here ? (
                <b data-drawer-name="">{c.text}</b>
              ) : c.go || c.repo ? (
                <button
                  type="button"
                  className="dw-crumb"
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
        {context !== null && <span className="dw-aside">context {tokens(context)}</span>}
        <span className="dw-state" data-tone={state.tone} data-drawer-state="">
          {state.text}
        </span>
        {child && <ChangesButton id={figure.kind === 'robot' ? figure.robot.id : tab.id} worktree={child.cwd} label={labelOf(figure)} />}
      </div>
      {line && (
        <div className="dw-topic" title={line}>
          {line}
        </div>
      )}
    </div>
  )
}
