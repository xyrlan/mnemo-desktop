import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'
import type { MenuItem } from './menus'
import './ui.css'

export type NexusMenuProps = {
  /** Where it opens, in viewport px (the click, or a button's corner); it stays on screen. */
  x: number
  y: number
  /** A line above the items: what it is a menu of. */
  head?: string
  items: MenuItem[]
  onClose(): void
}

/** A menu in the ship's look. ↑ ↓ move, Enter runs, Esc or a click outside closes; an item closes
 *  the menu before it runs. With no item it says so. */
export function NexusMenu({ x, y, head, items, onClose }: NexusMenuProps): JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  const live = items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0)
  const [active, setActive] = useState(live[0] ?? -1)

  useLayoutEffect(() => {
    const r = box.current?.getBoundingClientRect()
    if (!r) return
    setPos({ left: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)), top: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) })
  }, [x, y])

  const run = (it: MenuItem | undefined) => {
    if (!it || it.disabled) return
    onClose()
    void it.run()
  }

  useEffect(() => {
    box.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!live.length) return
        const k = live.indexOf(active)
        setActive(live[(k + (e.key === 'ArrowDown' ? 1 : -1) + live.length) % live.length])
      } else if (e.key === 'Enter') run(items[active])
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) onClose()
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('mousedown', onDown, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('mousedown', onDown, true)
    }
  })

  return (
    <div ref={box} className="nx nx-menu" role="menu" tabIndex={-1} style={pos} data-nx-menu="">
      {head && <div className="nx-menu-head">{head}</div>}
      {items.length === 0 && <div className="nx-menu-head">nothing to do here</div>}
      {items.map((it, i) => (
        <button
          key={it.id}
          type="button"
          role="menuitem"
          className="nx-menu-item"
          data-active={i === active ? '' : undefined}
          data-danger={it.danger ? '' : undefined}
          disabled={it.disabled}
          onMouseEnter={() => !it.disabled && setActive(i)}
          onClick={() => run(it)}
        >
          {it.label}
          {it.hint && <span className="nx-hint">{it.hint}</span>}
        </button>
      ))}
    </div>
  )
}
