import { useEffect, useMemo, useRef, type ComponentType, type PointerEvent } from 'react'
import { useStore } from 'zustand'
import { SquareTerminal, X } from 'lucide-react'
import { Button } from '@/ui'
import type { PaneViewProps } from '../panes/registry'
import type { Bounds } from '../floating/bounds'
import { ResizeHandles } from '../floating/ResizeHandles'
import type { SessionHost } from '../session/host'
import type { Popup, PopoutStore } from './store'

type Props = {
  store: PopoutStore
  host: SessionHost
  /** Draws one terminal: the terminal pane view (`src/terminal/view.tsx`) in the app. */
  terminal: ComponentType<PaneViewProps>
}

/** Every popup, bottom to top. Above the Nexus drawer (z-40) and the floating terminal (z-45),
 *  under the modal layer (z-50), so ⌘K still opens over them. */
export function Popouts({ store, host, terminal }: Props) {
  const popups = useStore(store, (s) => s.popups)
  return (
    <>
      {popups.map((p) => (
        <PopoutWindow key={p.key} popup={p} store={store} host={host} terminal={terminal} />
      ))}
    </>
  )
}

function PopoutWindow({ popup, store, host, terminal: Terminal }: { popup: Popup } & Props) {
  const panel = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointerId: number; startX: number; startY: number; bounds: Bounds } | null>(null)
  const { key, bounds } = popup
  const session = useStore(host, (s) => s.sessions[key])
  const pty = session?.pty ?? null
  const kind = session?.kind
  const error = session?.error
  // A presentation's view: it takes the session as it opens, and a key after the program exits
  // closes this popup, never a pane.
  const view = useMemo(() => ({ present: true, close: () => void store.getState().close(key) }), [store, key])

  // Opened, it takes the keyboard.
  useEffect(() => {
    if (pty === null) return
    const frame = requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>('textarea')?.focus())
    return () => cancelAnimationFrame(frame)
  }, [pty])

  const onDragStart = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target instanceof Element && e.target.closest('button'))) return
    drag.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, bounds }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onDragMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    store.getState().place(key, { ...d.bounds, left: d.bounds.left + e.clientX - d.startX, top: d.bounds.top + e.clientY - d.startY })
  }
  const onDragEnd = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId === e.pointerId) drag.current = null
  }

  return (
    <div
      ref={panel}
      data-ui=""
      data-popout={key}
      data-session-pty={pty ?? ''}
      className="fixed z-[46] flex min-h-[280px] min-w-[420px] rounded-lg bg-transparent text-card-foreground shadow-[0_4px_12px_rgba(0,0,0,0.16),0_24px_64px_rgba(0,0,0,0.32)] dark:shadow-[0_8px_20px_rgba(0,0,0,0.35),0_28px_72px_rgba(0,0,0,0.58)]"
      style={{ left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }}
      onPointerDownCapture={() => store.getState().raise(key)}
    >
      <div className="relative flex h-full w-full min-h-0 flex-col overflow-hidden rounded-lg border border-black/14 bg-card dark:border-white/14">
        <div
          data-popout-titlebar=""
          className="flex h-9 shrink-0 cursor-grab items-center gap-2 border-b border-border bg-card pl-3 select-none active:cursor-grabbing"
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
        >
          <SquareTerminal className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate text-xs font-medium" title={popup.title}>
            {popup.title}
          </span>
          {kind === 'attach' && <span className="shrink-0 text-xs text-muted-foreground">attach</span>}
          <div className="ml-auto flex items-center gap-1 px-2">
            <Button
              type="button"
              variant="outline"
              size="icon-xs"
              className="border-border bg-secondary text-secondary-foreground shadow-xs hover:bg-accent hover:text-accent-foreground"
              aria-label={kind === 'attach' ? `Detach and close ${popup.title}` : `Close popup of ${popup.title}`}
              onClick={() => void store.getState().close(key)}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        </div>
        <div className="relative min-h-0 flex-1 overflow-hidden bg-background pt-1 pl-2">
          {pty !== null && <Terminal id={pty} props={view} />}
          {error && <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-muted-foreground">{error}</p>}
          {pty === null && !error && (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">Attaching…</div>
          )}
        </div>
      </div>
      <ResizeHandles bounds={bounds} onPreview={(b) => store.getState().place(key, b)} onCommit={() => {}} />
    </div>
  )
}
