// adapted from stablyai/orca src/renderer/src/components/floating-terminal/FloatingTerminalResizeHandles.tsx (MIT, 122b8c25)
import { useRef, type PointerEvent } from 'react'
import { resizeBounds, type Bounds, type ResizeEdge } from './bounds'

const RESIZE_HANDLES = [
  ['n', 'top-0 left-2 right-2 h-2 cursor-n-resize'],
  ['s', 'bottom-0 left-2 right-2 h-2 cursor-s-resize'],
  ['w', 'left-0 top-2 bottom-2 w-2 cursor-w-resize'],
  ['e', 'right-0 top-2 bottom-2 w-2 cursor-e-resize'],
  ['nw', 'left-0 top-0 size-3 cursor-nw-resize'],
  ['ne', 'right-0 top-0 size-3 cursor-ne-resize'],
  ['sw', 'left-0 bottom-0 size-3 cursor-sw-resize'],
  ['se', 'right-0 bottom-0 size-3 cursor-se-resize'],
] as const satisfies readonly (readonly [ResizeEdge, string])[]

type Props = {
  bounds: Bounds
  onPreview(b: Bounds): void
  onCommit(): void
}

/** The panel's edges and corners, each a strip that resizes it by dragging. */
export function ResizeHandles({ bounds, onPreview, onCommit }: Props) {
  const drag = useRef<{ pointerId: number; edge: ResizeEdge; startX: number; startY: number; bounds: Bounds; moved: boolean } | null>(null)

  const start = (edge: ResizeEdge) => (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    drag.current = { pointerId: e.pointerId, edge, startX: e.clientX, startY: e.clientY, bounds, moved: false }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (dx === 0 && dy === 0) return
    d.moved = true
    onPreview(resizeBounds(d.bounds, d.edge, dx, dy))
  }
  const end = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    if (d.moved) onCommit()
    drag.current = null
  }

  return (
    <>
      {RESIZE_HANDLES.map(([edge, className]) => (
        <div
          key={edge}
          data-resize-edge={edge}
          className={`absolute z-10 ${className}`}
          onPointerDown={start(edge)}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        />
      ))}
    </>
  )
}
