// adapted from stablyai/orca src/renderer/src/components/floating-terminal/FloatingTerminalPanelSurface.tsx,
// FloatingTerminalWindowControls.tsx and floating-terminal-panel-drag-actions.ts (MIT, 122b8c25)
import { useEffect, useRef, type ComponentType, type PointerEvent, type MouseEvent } from 'react'
import { useStore } from 'zustand'
import { Maximize2, Minimize2, Minus, SquareTerminal } from 'lucide-react'
import { Button, Tooltip, TooltipContent, TooltipTrigger } from '@/ui'
import type { PaneViewProps } from '../panes/registry'
import type { Bounds } from './bounds'
import { ResizeHandles } from './ResizeHandles'
import type { FloatingActions, FloatingState, FloatingStore } from './store'

/** The shortcut `floating-terminal.toggle` is bound to (the keymap's, Mod+Alt+A). */
export const TOGGLE_SHORTCUT = '⌘⌥A'

/** Interactive chrome inside the titlebar, which must never also move the panel. */
const NO_DRAG = 'button,input,textarea,select,[role="menuitem"],[data-floating-terminal-no-drag]'
const isDragTarget = (t: EventTarget) => !(t instanceof Element && t.closest(NO_DRAG))

const controlButton = 'border-border bg-secondary text-secondary-foreground shadow-xs hover:bg-accent hover:text-accent-foreground'

const basename = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p

type Props = {
  store: FloatingStore
  /** Draws one shell: the terminal pane view (`src/terminal/view.tsx`) in the app. */
  terminal: ComponentType<PaneViewProps>
}

const NO_PROPS = {}

/** Orca's floating terminal: a panel over the app holding the active worktree's own shell,
 *  dragged by its titlebar, resized from any edge, maximized by a double-click. Closing it only
 *  hides it: the shell runs on, and every worktree's shell keeps its screen. */
export function FloatingTerminal({ store, terminal: Terminal }: Props) {
  const use = <T,>(sel: (s: FloatingState & FloatingActions) => T) => useStore(store, sel)
  const open = use((s) => s.open)
  const maximized = use((s) => s.maximized)
  const bounds = use((s) => s.bounds)
  const where = use((s) => s.where)
  const shells = use((s) => s.shells)
  const shown = shells[where.key]
  const panel = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointerId: number; startX: number; startY: number; bounds: Bounds; moved: boolean } | null>(null)

  // Opened, the shell takes the keyboard; closed, the keyboard goes back where it was.
  const before = useRef<Element | null>(null)
  useEffect(() => {
    if (!open) return
    before.current = document.activeElement
    return () => {
      const el = panel.current
      if (!el || !el.contains(document.activeElement)) return
      const back = before.current
      if (back instanceof HTMLElement && back.isConnected && !el.contains(back)) back.focus()
      else (document.activeElement as HTMLElement | null)?.blur?.()
    }
  }, [open])
  useEffect(() => {
    if (!open || shown?.pty == null) return
    const frame = requestAnimationFrame(() => {
      panel.current?.querySelector<HTMLElement>(`[data-floating-shell="${shown.pty}"] textarea`)?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [open, shown?.pty])

  const onDragStart = (e: PointerEvent<HTMLDivElement>) => {
    if (maximized || e.button !== 0 || !isDragTarget(e.target)) return
    drag.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, bounds, moved: false }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onDragMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (dx === 0 && dy === 0) return
    d.moved = true
    store.getState().preview({ ...d.bounds, left: d.bounds.left + dx, top: d.bounds.top + dy })
  }
  const onDragEnd = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    if (d.moved) store.getState().commit()
    drag.current = null
  }
  const onDoubleClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !isDragTarget(e.target)) return
    e.preventDefault()
    store.getState().toggleMaximized()
  }

  const where_ = where.cwd ? basename(where.cwd) : null
  return (
    // Above the z-40 notification cards, under the z-50 modal layer (Orca's order). The drop
    // shadow is on the outer shell and the border on an inner one: both on one rounded node make
    // stubby corners.
    <div
      ref={panel}
      data-ui=""
      data-floating-terminal=""
      aria-hidden={!open}
      inert={!open}
      className={`fixed z-[45] flex min-h-[280px] min-w-[420px] rounded-lg bg-transparent text-card-foreground shadow-[0_4px_12px_rgba(0,0,0,0.16),0_24px_64px_rgba(0,0,0,0.32)] outline-none dark:shadow-[0_8px_20px_rgba(0,0,0,0.35),0_28px_72px_rgba(0,0,0,0.58)] ${open ? 'opacity-100' : 'invisible pointer-events-none opacity-0'}`}
      style={{ visibility: open ? 'visible' : 'hidden', left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }}
    >
      <div className="relative flex h-full w-full min-h-0 flex-col overflow-hidden rounded-lg border border-black/14 bg-card dark:border-white/14">
        <div
          data-floating-terminal-titlebar=""
          className={`flex h-9 shrink-0 items-center gap-2 border-b border-border bg-card pl-3 select-none ${maximized ? '' : 'cursor-grab active:cursor-grabbing'}`}
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
          onDoubleClick={onDoubleClick}
        >
          <SquareTerminal className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="text-xs font-medium">Terminal</span>
          {where_ && (
            <span className="min-w-0 truncate text-xs text-muted-foreground" title={where.cwd}>
              {where_}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1 px-2" data-floating-terminal-no-drag="">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-xs"
                  className={controlButton}
                  aria-label={maximized ? 'Restore floating terminal' : 'Maximize floating terminal'}
                  aria-pressed={maximized}
                  onClick={() => store.getState().toggleMaximized()}
                >
                  {maximized ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                {maximized ? 'Restore' : 'Maximize'}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-xs"
                  className={controlButton}
                  aria-label="Minimize floating terminal"
                  onClick={() => store.getState().hide()}
                >
                  <Minus className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                Minimize ({TOGGLE_SHORTCUT})
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div className="relative min-h-0 flex-1 overflow-hidden bg-background">
          {/* Every worktree's shell stays mounted, the others hidden, so each keeps its screen. */}
          {Object.values(shells).map((s) =>
            s.pty === null ? null : (
              <div
                key={s.pty}
                data-floating-shell={s.pty}
                className={s.key === where.key ? 'absolute inset-0 pt-1 pl-2' : 'absolute inset-0 hidden'}
                aria-hidden={s.key !== where.key}
              >
                <Terminal id={s.pty} props={NO_PROPS} />
              </div>
            ),
          )}
          {shown?.error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center text-sm text-muted-foreground">
              <p>Could not start a shell: {shown.error}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => store.getState().show()}>
                Try again
              </Button>
            </div>
          )}
          {open && shown && shown.pty === null && !shown.error && (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">Starting a shell…</div>
          )}
        </div>
      </div>
      {!maximized && <ResizeHandles bounds={bounds} onPreview={(b) => store.getState().preview(b)} onCommit={() => store.getState().commit()} />}
    </div>
  )
}

/** The titlebar button that shows and hides the panel. */
export function FloatingTerminalToggle({ store }: { store: FloatingStore }) {
  const open = useStore(store, (s) => s.open)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="sidebar-toggle mr-1"
          aria-label="Toggle floating terminal"
          aria-pressed={open}
          onClick={() => store.getState().toggle()}
        >
          <SquareTerminal size={16} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        Floating terminal ({TOGGLE_SHORTCUT})
      </TooltipContent>
    </Tooltip>
  )
}
