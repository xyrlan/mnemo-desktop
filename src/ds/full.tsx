// A value that may not fit its line, with no tooltip: it is cut with an ellipsis, and when it
// is cut it can be opened where it stands (a click, or Enter or Space with focus on it) to
// read whole, wrapped. Nothing is hidden behind a hover, and what fits is plain text.

import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'

/** Where `value` is split when its end is the part to keep: after the last path separator, or
 *  twelve characters from the end when it has none. 0 when there is nothing to keep apart. */
export function tailStart(value: string): number {
  const trimmed = value.replace(/[\\/]+$/, '')
  const slash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (slash > 0) return slash + 1
  return value.length > 24 ? value.length - 12 : 0
}

/** `value` on one line. `keep="end"` cuts in the middle and keeps the end whole: a path's file
 *  name, an id's last characters. */
export function Full({ value, keep = 'start', className }: { value: string; keep?: 'start' | 'end'; className?: string }) {
  const head = useRef<HTMLSpanElement>(null)
  const [cut, setCut] = useState(false)
  const [open, setOpen] = useState(false)
  const split = keep === 'end' ? tailStart(value) : value.length

  useLayoutEffect(() => {
    const el = head.current
    if (!el) return
    // Opened, it wraps and nothing overflows: it is measured again when it closes (`open` below).
    const measure = () => setCut(el.scrollWidth > el.clientWidth + 1)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const watching = new ResizeObserver(measure)
    watching.observe(el)
    return () => watching.disconnect()
  }, [value, keep, open])

  // open, it no longer overflows, and must still be something to close
  const can = cut || open
  const toggle = () => setOpen((o) => !o)
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    e.stopPropagation()
    toggle()
  }
  return (
    <span
      className={`mn-full ${className ?? ''}`}
      data-keep={keep}
      data-cut={cut ? 'true' : undefined}
      data-open={open ? 'true' : undefined}
      {...(can ? { role: 'button', tabIndex: 0, 'aria-expanded': open, onClick: toggle, onKeyDown, onBlur: () => setOpen(false) } : {})}
    >
      <span ref={head} className="mn-full-head">
        {value.slice(0, split)}
      </span>
      {split < value.length && <span className="mn-full-tail">{value.slice(split)}</span>}
    </span>
  )
}
