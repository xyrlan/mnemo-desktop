// adapted from stablyai/orca src/renderer/src/hooks/useSidebarResize.ts (MIT, 122b8c25)
import type React from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

type UseSidebarResizeOptions = {
  isOpen: boolean
  width: number
  minWidth: number
  maxWidth: number
  /** 1: dragging right widens it (a left sidebar); -1: dragging left does (a right one). */
  deltaSign: 1 | -1
  setWidth: (width: number) => void
  /** Every width the container is drawn at, the live ones of a drag included. */
  onDraftWidthChange?: (width: number) => void
}

type UseSidebarResizeResult<T extends HTMLElement> = {
  containerRef: React.RefObject<T | null>
  isResizing: boolean
  onResizeStart: (event: React.MouseEvent) => void
}

export function clampSidebarResizeWidth(width: number, minWidth: number, maxWidth: number): number {
  return Math.min(maxWidth, Math.max(minWidth, width))
}

export function getRenderedSidebarWidthCssValue(isOpen: boolean, width: number): string {
  return isOpen ? `${width}px` : '0px'
}

export function getNextSidebarResizeWidth({
  clientX,
  startX,
  startWidth,
  deltaSign,
  minWidth,
  maxWidth,
}: {
  clientX: number
  startX: number
  startWidth: number
  deltaSign: 1 | -1
  minWidth: number
  maxWidth: number
}): number {
  const delta = (clientX - startX) * deltaSign
  return clampSidebarResizeWidth(startWidth + delta, minWidth, maxWidth)
}

/** Drag-resizes a sidebar column. The width of a drag in flight is written to the container's
 *  style, not to the store, and committed (`setWidth`) on release: a rerender mid-drag would
 *  otherwise snap the column back to the stored width. */
export function useSidebarResize<T extends HTMLElement>({
  isOpen,
  width,
  minWidth,
  maxWidth,
  deltaSign,
  setWidth,
  onDraftWidthChange,
}: UseSidebarResizeOptions): UseSidebarResizeResult<T> {
  const containerRef = useRef<T | null>(null)
  const isResizingRef = useRef(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(width)
  const draftWidthRef = useRef(width)
  const frameRef = useRef<number | null>(null)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const [isResizing, setIsResizing] = useState(false)

  const removeDragOverlay = useCallback(() => {
    overlayRef.current?.remove()
    overlayRef.current = null
  }, [])

  const resetDocumentStyles = useCallback(() => {
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    removeDragOverlay()
  }, [removeDragOverlay])

  const applyRenderedWidth = useCallback(
    (nextWidth: number) => {
      const container = containerRef.current
      if (!container) return
      container.style.width = getRenderedSidebarWidthCssValue(isOpen, nextWidth)
    },
    [isOpen],
  )

  useLayoutEffect(() => {
    if (isResizingRef.current) return
    draftWidthRef.current = width
    applyRenderedWidth(width)
    onDraftWidthChange?.(width)
  }, [applyRenderedWidth, onDraftWidthChange, width])

  const stopResize = useCallback(() => {
    if (!isResizingRef.current) return
    isResizingRef.current = false
    setIsResizing(false)
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
    resetDocumentStyles()
    const finalWidth = draftWidthRef.current
    applyRenderedWidth(finalWidth)
    onDraftWidthChange?.(finalWidth)
    if (finalWidth !== width) setWidth(finalWidth)
  }, [applyRenderedWidth, onDraftWidthChange, resetDocumentStyles, setWidth, width])

  const handleMouseMove = useCallback(
    (event: MouseEvent) => {
      if (!isResizingRef.current) return
      const nextWidth = getNextSidebarResizeWidth({
        clientX: event.clientX,
        startX: startXRef.current,
        startWidth: startWidthRef.current,
        deltaSign,
        minWidth,
        maxWidth,
      })
      if (nextWidth === draftWidthRef.current) return
      draftWidthRef.current = nextWidth
      if (frameRef.current !== null) return
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null
        applyRenderedWidth(draftWidthRef.current)
        onDraftWidthChange?.(draftWidthRef.current)
      })
    },
    [applyRenderedWidth, deltaSign, maxWidth, minWidth, onDraftWidthChange],
  )

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', stopResize)
    window.addEventListener('blur', stopResize)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', stopResize)
      window.removeEventListener('blur', stopResize)
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
      isResizingRef.current = false
      resetDocumentStyles()
    }
  }, [handleMouseMove, resetDocumentStyles, stopResize])

  const onResizeStart = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault()
      isResizingRef.current = true
      setIsResizing(true)
      startXRef.current = event.clientX
      startWidthRef.current = width
      draftWidthRef.current = width
      onDraftWidthChange?.(width)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      // Why: whatever the pointer crosses mid-drag may keep the events to itself (an iframe
      // gets them in its own document), and a `mouseup` the window never sees leaves the
      // sidebar following the cursor. A transparent overlay above everything keeps them
      // flowing to the window listeners until release.
      if (!overlayRef.current) {
        const overlay = document.createElement('div')
        overlay.style.position = 'fixed'
        overlay.style.inset = '0'
        overlay.style.zIndex = '2147483647'
        overlay.style.cursor = 'col-resize'
        overlay.style.background = 'transparent'
        overlay.dataset.sidebarResizeOverlay = ''
        document.body.appendChild(overlay)
        overlayRef.current = overlay
      }
    },
    [onDraftWidthChange, width],
  )

  return { containerRef, isResizing, onResizeStart }
}
