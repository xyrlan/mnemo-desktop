// adapted from stablyai/orca src/renderer/src/components/tab-bar/tab-strip-pointer-activation.ts
import { useCallback, useEffect, useRef } from 'react'

/** Pixels a press travels before it is a drag, not a click (dnd-kit's activation distance too). */
export const TAB_DRAG_ACTIVATION_DISTANCE_PX = 12

/** Activates a tab on release, and only when the press did not turn into a drag: dragging a tab
 *  to reorder it never switches tabs or takes focus from the terminal mid-gesture. The release
 *  position decides, not a drag flag that clears on its own schedule, so a click right after a
 *  reorder still activates. */
export function usePointerActivation({ onActivate, disabled = false }: { onActivate: () => void; disabled?: boolean }) {
  const onActivateRef = useRef(onActivate)
  onActivateRef.current = onActivate
  const cleanupRef = useRef<(() => void) | null>(null)

  // A press still held when the tab unmounts (closed mid-drag) would leak its listeners.
  useEffect(() => () => cleanupRef.current?.(), [])

  const onPointerDown = useCallback(
    (event: React.PointerEvent, dragListener?: (event: React.PointerEvent) => void) => {
      if (disabled || event.button !== 0) return
      // dnd-kit starts its gesture now; only the activation waits for the release.
      dragListener?.(event)
      cleanupRef.current?.()
      const startX = event.clientX
      const startY = event.clientY
      const cleanup = () => {
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', cleanup)
        window.removeEventListener('blur', cleanup)
        cleanupRef.current = null
      }
      const onUp = (up: PointerEvent) => {
        const dragged = Math.hypot(up.clientX - startX, up.clientY - startY) >= TAB_DRAG_ACTIVATION_DISTANCE_PX
        cleanup()
        if (!dragged) onActivateRef.current()
      }
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', cleanup)
      window.addEventListener('blur', cleanup)
      cleanupRef.current = cleanup
    },
    [disabled],
  )

  return { onPointerDown }
}
