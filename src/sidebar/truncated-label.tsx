// adapted from stablyai/orca components/sidebar/truncated-sidebar-label.tsx (MIT, 122b8c25)
import React, { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui'
import { cn } from '@/ui/cn'

/** A one-line label that shows its full text in a tooltip only when it does not fit. */
export function TruncatedSidebarLabel({
  text,
  className,
  children,
}: {
  text: string
  className?: string
  /** What the label shows; `text` when absent. `text` stays the tooltip. */
  children?: React.ReactNode
}): React.JSX.Element {
  const nodeRef = useRef<HTMLSpanElement | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const [truncated, setTruncated] = useState(false)

  const measure = useCallback((el: HTMLSpanElement | null) => {
    const next = el ? el.scrollWidth > el.clientWidth : false
    setTruncated((cur) => (cur === next ? cur : next))
  }, [])

  const handleRef = useCallback(
    (node: HTMLSpanElement | null) => {
      cleanupRef.current?.()
      cleanupRef.current = null
      nodeRef.current = node
      measure(node)
      if (!node) return
      const update = () => measure(node)
      if (typeof ResizeObserver === 'undefined') {
        window.addEventListener('resize', update)
        cleanupRef.current = () => window.removeEventListener('resize', update)
        return
      }
      const observer = new ResizeObserver(update)
      observer.observe(node)
      cleanupRef.current = () => observer.disconnect()
    },
    [measure],
  )

  // Why: ResizeObserver does not fire when only the text changes, but scrollWidth can.
  useLayoutEffect(() => measure(nodeRef.current), [measure, text])

  const label = (
    <span ref={handleRef} className={cn('block min-w-0 truncate', className)}>
      {children ?? text}
    </span>
  )
  if (!truncated) return label
  return (
    <Tooltip>
      <TooltipTrigger asChild>{label}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8} className="max-w-80 whitespace-normal break-all text-left">
        {text}
      </TooltipContent>
    </Tooltip>
  )
}
