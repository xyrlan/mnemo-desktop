// adapted from stablyai/orca src/renderer/src/app-shell/AppWorkspaceShell.tsx,
// TitlebarLeftControls.tsx, TitlebarMainStrip.tsx, AppRootSurfaces.tsx [176-194] and
// components/sidebar/index.tsx, components/right-sidebar/index.tsx (the columns and their resize
// handles) (MIT, 122b8c25)
import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { PanelLeft, PanelRight } from 'lucide-react'
import { Toaster, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui'
import { cn } from '@/ui/cn'
import { LEFT_MAX, LEFT_MIN, RIGHT_MIN, rightMaxFor, rightWidthFor, useShell } from './store'
import { useSlot } from './slots'
import { SlotOutlet } from './Slot'
import { useSidebarResize } from './use-sidebar-resize'
import Workbench from './Workbench'
import './shell.css'

// Why: straddle the sidebar/workbench seam so the divider sits on the edge instead of leaving
// a blank strip between the hover target and it.
const LEFT_HANDLE = 'group absolute -right-1.5 top-0 z-10 flex h-full w-3 cursor-col-resize items-stretch justify-center'
const LEFT_HANDLE_LINE = 'h-full w-px bg-transparent transition-colors group-hover:bg-ring/50 group-active:bg-ring'

/** Orca's runtime chrome variables. The window keeps its native title bar on every platform,
 *  so nothing is drawn over the web content's corners: they are all 0. */
const CHROME_VARS = {
  '--window-controls-width': '0px',
  '--window-controls-height': '0px',
  '--mac-traffic-lights-width': '0px',
  '--collapsed-sidebar-header-width': '0px',
} as CSSProperties

function useWindowWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth)
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return width
}

function LeftSidebarToggle() {
  const toggle = useShell((s) => s.toggleLeft)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="sidebar-toggle" onClick={toggle} aria-label="Toggle sidebar">
          <PanelLeft size={16} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        Toggle sidebar (⌘B)
      </TooltipContent>
    </Tooltip>
  )
}

function RightSidebarToggle() {
  const toggle = useShell((s) => s.toggleRight)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="sidebar-toggle mr-2" onClick={toggle} aria-label="Toggle right sidebar">
          <PanelRight size={16} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        Toggle right sidebar (⌘L)
      </TooltipContent>
    </Tooltip>
  )
}

/** The titlebar's left cluster: the app's name and the sidebar toggle. Above the open left
 *  sidebar, or at the start of the titlebar while it is closed. */
function TitlebarLeftControls({ toggle }: { toggle: boolean }) {
  return (
    <div className="flex h-full w-full shrink-0 items-center">
      <div className="pl-2" />
      <div className="titlebar-app-name" aria-label="mnemo">
        <span className="titlebar-app-name-main">mnemo</span>
      </div>
      {toggle && <LeftSidebarToggle />}
    </div>
  )
}

/** The left column: the titlebar's left end over the sidebar, in the sidebar's tint. Closed, it
 *  is 0 wide and inert, its component still mounted. */
function LeftColumn() {
  const open = useShell((s) => s.leftOpen)
  const width = useShell((s) => s.leftWidth)
  const setWidth = useShell((s) => s.setLeftWidth)
  // Orca's name for it, which the dashboard drawer (adapted from Orca) reads to follow a drag.
  const setLiveWidth = useCallback((w: number) => document.documentElement.style.setProperty('--workspace-sidebar-live-width', `${open ? w : 0}px`), [open])
  const { containerRef, onResizeStart, isResizing } = useSidebarResize<HTMLDivElement>({
    isOpen: open,
    width,
    minWidth: LEFT_MIN,
    maxWidth: LEFT_MAX,
    deltaSign: 1,
    setWidth,
    onDraftWidthChange: setLiveWidth,
  })
  return (
    <div
      ref={containerRef}
      data-shell-column="left"
      data-open={open}
      inert={!open}
      className={cn(
        'relative flex min-h-0 shrink-0 flex-col bg-worktree-sidebar text-worktree-sidebar-foreground',
        // Open, the resize handle hangs over the seam; closed, nothing may leak past 0 wide.
        open ? 'overflow-visible' : 'overflow-hidden',
      )}
    >
      <div className="titlebar-left">
        <TitlebarLeftControls toggle />
      </div>
      <div data-shell-slot="left-sidebar" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <SlotOutlet slot="left-sidebar" />
      </div>
      {open && (
        <div data-sidebar-resize-handle="" className={cn(LEFT_HANDLE, isResizing && 'bg-ring/10')} onMouseDown={onResizeStart}>
          <div className={cn(LEFT_HANDLE_LINE, isResizing && 'bg-ring')} />
        </div>
      )}
    </div>
  )
}

/** The right column, the full window height above the status bar. Its component draws the
 *  header (and the close button in it); the shell draws the edge and the resize strip. */
function RightColumn({ leftTaken }: { leftTaken: number }) {
  const open = useShell((s) => s.rightOpen)
  const stored = useShell((s) => s.rightWidth)
  const setWidth = useShell((s) => s.setRightWidth)
  const windowWidth = useWindowWidth()
  const { containerRef, onResizeStart, isResizing } = useSidebarResize<HTMLDivElement>({
    isOpen: open,
    width: rightWidthFor(stored, windowWidth, leftTaken),
    minWidth: RIGHT_MIN,
    maxWidth: rightMaxFor(windowWidth, leftTaken),
    deltaSign: -1,
    setWidth,
  })
  return (
    <div
      ref={containerRef}
      data-shell-column="right"
      data-open={open}
      inert={!open}
      className={cn('relative flex min-h-0 shrink-0 flex-col bg-sidebar text-sidebar-foreground', open ? 'overflow-visible border-l border-sidebar-border' : 'overflow-hidden')}
    >
      <div data-shell-slot="right-sidebar" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <SlotOutlet slot="right-sidebar" />
      </div>
      {open && (
        <div
          data-sidebar-resize-handle=""
          className={cn('absolute top-0 left-0 z-10 h-full w-1 cursor-col-resize transition-colors hover:bg-ring/20 active:bg-ring/30', isResizing && 'bg-ring/30')}
          onMouseDown={onResizeStart}
        />
      )}
    </div>
  )
}

/** The titlebar over the workbench: the tab strip, the right-end cluster, and the right
 *  sidebar's toggle while it is closed (open, its own header has one). */
function TitlebarMainStrip({ leftControls, leftToggle, rightToggle }: { leftControls: boolean; leftToggle: boolean; rightToggle: boolean }) {
  return (
    <div className="titlebar" data-shell-titlebar="">
      {leftControls && (
        <div className="mr-2 flex h-full shrink-0 items-center border-r border-border">
          <TitlebarLeftControls toggle={leftToggle} />
        </div>
      )}
      <div data-shell-slot="titlebar-tabs" className="flex min-w-0 flex-1 self-stretch">
        <SlotOutlet slot="titlebar-tabs" />
      </div>
      <div data-shell-slot="titlebar-right" className="flex shrink-0 items-center self-stretch">
        <SlotOutlet slot="titlebar-right" />
      </div>
      {rightToggle && <RightSidebarToggle />}
    </div>
  )
}

function StatusBarRow() {
  const mounted = useSlot('status-bar').length > 0
  // With no bar mounted, Orca's fallback strip holds the row so the layout does not jump.
  if (!mounted) return <div data-shell-slot="status-bar" className="h-6 min-h-[24px] shrink-0 border-t border-border bg-card" />
  return (
    <div data-shell-slot="status-bar" className="flex shrink-0 flex-col">
      <SlotOutlet slot="status-bar" />
    </div>
  )
}

type Props = {
  /** The saved workspace is restored. */
  ready: boolean
  /** Why it could not be, until dismissed. */
  notice: string | null
  onDismissNotice(): void
}

/** Orca's app shell: titlebar, left sidebar, workbench, right sidebar, status bar, and the
 *  overlays over all of it. Every screen in it mounts itself through `mountInSlot`. */
export default function Shell({ ready, notice, onDismissNotice }: Props) {
  const leftOpen = useShell((s) => s.leftOpen)
  const leftWidth = useShell((s) => s.leftWidth)
  const rightOpen = useShell((s) => s.rightOpen)
  const hasLeft = useSlot('left-sidebar').length > 0
  const hasRight = useSlot('right-sidebar').length > 0
  const leftShown = hasLeft && leftOpen

  return (
    <TooltipProvider delayDuration={400}>
      <div data-shell="" className="flex h-full w-full flex-col overflow-hidden bg-background font-sans text-foreground" style={CHROME_VARS}>
        <div className="flex min-h-0 flex-1 flex-row overflow-hidden">
          {hasLeft && <LeftColumn />}
          <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden', leftShown && 'border-l border-border')}>
            <TitlebarMainStrip leftControls={!leftShown} leftToggle={hasLeft} rightToggle={hasRight && !rightOpen} />
            <Workbench ready={ready} notice={notice} onDismissNotice={onDismissNotice} />
          </div>
          {hasRight && <RightColumn leftTaken={leftShown ? leftWidth : 0} />}
        </div>
        <StatusBarRow />
      </div>
      <SlotOutlet slot="overlay" />
      <Toaster closeButton toastOptions={{ className: 'font-sans text-sm' }} />
    </TooltipProvider>
  )
}
