import { useEffect, useMemo, useRef, type JSX, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { closeWindow, useOpenWindow, windowDef, type WindowContext } from './windows'
import './ui.css'

export type NexusWindowProps = {
  title: string
  /** A line beside the title. */
  sub?: string
  width?: number
  onClose(): void
  children: ReactNode
}

/** Whether a key typed at `target` is the open window's: typed in it or on its backdrop, or with
 *  the focus nowhere. One typed elsewhere (the drawer's terminal) belongs where it was typed. */
export function typedInWindow(target: EventTarget | null): boolean {
  if (!(target instanceof Element) || target === document.body || target === document.documentElement) return true
  return target.closest('[data-nx-backdrop]') !== null
}

/** A window in the ship's look: over the ship and the drawer, both dimmed behind it. It is drawn at
 *  the end of `<body>`: inside the Nexus's layer, the drawer (the same layer, later) would paint over
 *  it. Esc typed in it and a click on the backdrop close it; focus moves into it as it opens and
 *  back where it was as it closes. */
export function NexusWindow({ title, sub, width = 720, onClose, children }: NexusWindowProps): JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    box.current?.focus()
    // On `document`, as it bubbles: what it was typed in has it first (a note's draft, Monaco's find,
    // a confirmation), and an Esc one of them took (stopped or prevented) leaves the window open.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || !typedInWindow(e.target)) return
      e.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      before?.focus?.()
    }
  }, [onClose])
  return createPortal(
    <div className="nx nx-backdrop" data-nx-backdrop="" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} className="nx-window" role="dialog" aria-label={title} tabIndex={-1} style={{ width }} data-state="open" data-nx-window="">
        <div className="nx-window-bar">
          <h2 className="nx-window-title">{title}</h2>
          {sub && <span className="nx-window-sub">{sub}</span>}
          <button type="button" className="nx-window-close" aria-label="Close" title="Close (Esc)" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="nx-window-body">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

/** Draws the registered window that is open, if any (mounted once, by the Nexus). `open` opens a
 *  figure in the drawer, true when it did (the Nexus's, as its menus get it); with none, a window
 *  opens no figure. */
export function WindowHost({ open: openFigure }: { open?(id: string): boolean } = {}): JSX.Element | null {
  const open = useOpenWindow()
  const def = open && windowDef(open.id)
  const ctx = useMemo<WindowContext>(
    () => ({
      open: (id) => {
        if (!openFigure?.(id)) return false
        closeWindow()
        return true
      },
    }),
    [openFigure],
  )
  if (!open || !def) return null
  return (
    <NexusWindow title={def.title} width={def.width} onClose={closeWindow}>
      {def.render(open.params, closeWindow, ctx)}
    </NexusWindow>
  )
}
