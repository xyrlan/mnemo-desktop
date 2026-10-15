import { useEffect, useRef, type JSX } from 'react'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import './ui.css'

/** What a confirmation asks: `confirm` labels the button that goes ahead; `danger` paints it red. */
export type ConfirmOptions = { title: string; body?: string; confirm: string; danger?: boolean }

type Pending = ConfirmOptions & { resolve(ok: boolean): void }

const store = createStore<{ pending: Pending | null }>(() => ({ pending: null }))

/** Asks, in the ship's look, above any window: true once the person goes ahead, false on Cancel, Esc
 *  or the backdrop. A second ask answers the first with false. */
export function confirm(opts: ConfirmOptions): Promise<boolean> {
  store.getState().pending?.resolve(false)
  return new Promise((resolve) => store.setState({ pending: { ...opts, resolve } }))
}

function answer(ok: boolean) {
  const p = store.getState().pending
  store.setState({ pending: null })
  p?.resolve(ok)
}

/** Draws the pending confirmation (mounted once, by the Nexus). Its Esc is caught on `window`,
 *  before a window's own on `document`, so it closes the question and not the window under it. */
export function ConfirmHost(): JSX.Element | null {
  const pending = useStore(store, (s) => s.pending)
  const go = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!pending) return
    go.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      answer(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [pending])
  if (!pending) return null
  return (
    <div className="nx nx-backdrop nx-confirm-layer" data-nx-confirm="" onMouseDown={(e) => e.target === e.currentTarget && answer(false)}>
      <div className="nx-window" role="alertdialog" aria-label={pending.title} style={{ width: 420 }}>
        <div className="nx-window-bar">
          <h2 className="nx-window-title">{pending.title}</h2>
        </div>
        <div className="nx-window-body">
          {pending.body && <p className="nx-confirm-body">{pending.body}</p>}
          <div className="nx-confirm-actions">
            <button type="button" className="nx-btn" onClick={() => answer(false)}>
              Cancel
            </button>
            <button ref={go} type="button" className="nx-btn" data-tone={pending.danger ? 'danger' : 'go'} onClick={() => answer(true)}>
              {pending.confirm}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
