import { useEffect, useRef, type JSX, type ReactNode } from 'react'
import { closeWindow, useOpenWindow, windowDef } from './windows'
import './ui.css'

export type NexusWindowProps = {
  title: string
  /** A line beside the title. */
  sub?: string
  width?: number
  onClose(): void
  children: ReactNode
}

/** A window in the ship's look: over the ship, the ship dimmed behind it. Esc and a click on the
 *  backdrop close it; focus moves into it as it opens and back where it was as it closes. */
export function NexusWindow({ title, sub, width = 720, onClose, children }: NexusWindowProps): JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    box.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      before?.focus?.()
    }
  }, [onClose])
  return (
    <div className="nx nx-backdrop" data-nx-backdrop="" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} className="nx-window" role="dialog" aria-label={title} tabIndex={-1} style={{ width }} data-nx-window="">
        <div className="nx-window-bar">
          <h2 className="nx-window-title">{title}</h2>
          {sub && <span className="nx-window-sub">{sub}</span>}
          <button type="button" className="nx-window-close" aria-label="Close" title="Close (Esc)" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="nx-window-body">{children}</div>
      </div>
    </div>
  )
}

/** Draws the registered window that is open, if any (mounted once, by the Nexus). */
export function WindowHost(): JSX.Element | null {
  const open = useOpenWindow()
  const def = open && windowDef(open.id)
  if (!open || !def) return null
  return (
    <NexusWindow title={def.title} width={def.width} onClose={closeWindow}>
      {def.render(open.params, closeWindow)}
    </NexusWindow>
  )
}
