// The terminals the app holds, drawn. Each hosted terminal has one view (`src/terminal/view.tsx`)
// for as long as it is held, as each drawer tab had: a terminal with no view answers none of its
// program's queries (a Windows pseudoconsole waits for its cursor report before the shell starts),
// and keeps no scrollback of its own. The views live in a hidden park at the root; `LiveTerminal`
// moves the one it shows into its own box and gives it back when it goes. Nothing is mounted
// twice and no terminal is drawn again from nothing when the stage changes.
//
// The view knows it is hidden by its box having no size, and hands its terminal to one on screen;
// shown again it takes it back (`props.active`), exactly as a drawer tab did.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type ComponentType } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { NexusState } from '../nexus/store'
import type { PaneViewProps } from '../panes/registry'
import type { SessionHostState } from '../session/host'
import type { Hosting, TerminalView } from './hosting'
import './runtime.css'

export type TerminalsDeps = {
  hosting: Pick<Hosting, 'view' | 'subscribe' | 'open'>
  nexus: StoreApi<Pick<NexusState, 'tabs'>>
  host: StoreApi<Pick<SessionHostState, 'sessions'>>
  /** Draws a terminal: `src/terminal/view.tsx` in the app. */
  terminal: ComponentType<PaneViewProps>
  /** What a key closes once a terminal's program has exited: its tab. */
  close(tab: string): void
}

/** What a terminal's view calls itself while it owns its terminal (`owners[pty].name`). */
export const viewName = (tab: string) => `runtime:${tab}`

const keyOf = (v: TerminalView) => (v.state === 'held' ? `held|${v.tab}|${v.pty ?? ''}|${v.error ?? ''}` : v.state)

/** Whether the keyboard is in a field of its own (a reply box, the command line): a terminal
 *  that comes on stage does not take it from there. */
function typingElsewhere(): boolean {
  const el = document.activeElement
  if (!(el instanceof HTMLElement) || el.closest('.xterm')) return false
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)
}

export function createTerminals(d: TerminalsDeps) {
  /** Where the views wait while no `LiveTerminal` shows them. */
  const park = document.createElement('div')
  park.setAttribute('data-runtime-park', '')
  park.setAttribute('aria-hidden', 'true')
  park.style.display = 'none'
  document.body.appendChild(park)

  /** One box per hosted terminal, by its tab: the view is drawn into it, wherever it stands. */
  const boxes = new Map<string, HTMLDivElement>()
  function boxOf(tab: string): HTMLDivElement {
    let box = boxes.get(tab)
    if (!box) {
      box = document.createElement('div')
      box.className = 'runtime-held'
      box.dataset.runtimeHeld = tab
      park.appendChild(box)
      boxes.set(tab, box)
    }
    return box
  }

  /** The tab a `LiveTerminal` shows now. */
  const shown = createStore<{ tab: string | null }>(() => ({ tab: null }))

  function Held({ tab, pty }: { tab: string; pty: number }) {
    const here = useStore(shown, (s) => s.tab === tab)
    const close = useCallback(() => d.close(tab), [tab])
    const props = useMemo(() => ({ present: true, name: viewName(tab), close, active: here }), [tab, close, here])
    const Terminal = d.terminal
    return <Terminal id={pty} props={props} />
  }

  /** Every held terminal's view, each in its own box. Mounted once, at the root. */
  function Pool() {
    const tabs = useStore(d.nexus, (s) => s.tabs)
    const sessions = useStore(d.host, (h) => h.sessions)
    // A tab that went takes its box with it.
    useEffect(() => {
      const open = new Set(tabs.map((t) => t.id))
      for (const [tab, box] of boxes) {
        if (open.has(tab)) continue
        box.remove()
        boxes.delete(tab)
      }
    }, [tabs])
    return (
      <>
        {tabs.map((t) => {
          const pty = t.key === null ? null : (sessions[t.key]?.pty ?? null)
          return pty === null ? null : createPortal(<Held tab={t.id} pty={pty} />, boxOf(t.id), t.id)
        })}
      </>
    )
  }

  function focus(): boolean {
    const tab = shown.getState().tab
    const input = tab === null ? null : boxes.get(tab)?.querySelector<HTMLElement>('.xterm textarea')
    if (!input) return false
    input.focus()
    return true
  }

  /** `LiveTerminal`'s body: the box the staged session's view is moved into, and what is said
   *  while there is none to move. */
  function LiveTerminal({ sessionId, active }: { sessionId: string; active: boolean }) {
    const slot = useRef<HTMLDivElement>(null)
    const key = useSyncExternalStore(d.hosting.subscribe, () => keyOf(d.hosting.view(sessionId)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const view = useMemo(() => d.hosting.view(sessionId), [sessionId, key])
    const tab = view.state === 'held' && view.pty !== null ? view.tab : null

    useLayoutEffect(() => {
      if (tab === null || !slot.current) return
      const box = boxOf(tab)
      slot.current.appendChild(box)
      shown.setState({ tab })
      return () => {
        if (boxes.get(tab) === box) park.appendChild(box)
        if (shown.getState().tab === tab) shown.setState({ tab: null })
      }
    }, [tab])

    // It takes the keys when it comes on stage active, and when it turns active.
    useEffect(() => {
      if (!active || tab === null || typingElsewhere()) return
      const frame = requestAnimationFrame(() => void focus())
      return () => cancelAnimationFrame(frame)
    }, [active, tab])

    return (
      <div className="runtime-terminal" data-live-terminal={sessionId} data-active={active || undefined} data-terminal-state={view.state} data-pty={view.state === 'held' ? (view.pty ?? '') : ''}>
        <div ref={slot} className="runtime-slot" />
        {view.state === 'held' && view.error !== null && <p className="runtime-note">{view.error}</p>}
        {(view.state === 'waiting' || (view.state === 'held' && view.pty === null && view.error === null)) && <p className="runtime-note">Attaching…</p>}
        {view.state === 'detached' && (
          <p className="runtime-note">
            Its terminal is not held here now.
            <button type="button" onClick={() => void d.hosting.open(sessionId)}>
              Show it
            </button>
          </p>
        )}
        {view.state === 'none' && <p className="runtime-note">No terminal to show for it here.</p>}
      </div>
    )
  }

  return {
    Pool,
    LiveTerminal,
    focus,
    dispose() {
      boxes.clear()
      park.remove()
    },
  }
}
