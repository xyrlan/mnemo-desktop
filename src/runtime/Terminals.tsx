// The terminals the app holds, drawn. Each hosted terminal has one view (`src/terminal/view.tsx`)
// for as long as it is held, as each drawer tab had: a terminal with no view answers none of its
// program's queries, and keeps no scrollback of its own. The views live in a hidden park at the
// root of the page; `LiveTerminal` moves the one it shows into its own box and gives it back when
// it goes. No terminal is drawn again from nothing when the stage changes.
//
// The park has a React root of its own, outside the app's StrictMode. In a dev build StrictMode
// mounts every new view, takes it down and mounts it again; the layout store then draws an
// offscreen terminal's second view from the core's saved screen, and what the terminal printed
// before that is gone. On Windows that includes the cursor report the pseudoconsole asks for
// before it starts the shell: nobody answers it, and the terminal stays blank for good (seen in a
// dev build, 2026-11-10: a shell opened from the new front printed nothing until the report was
// written by hand). A view mounted once answers it, in a dev build as in a release.
//
// A view knows it is hidden by its box having no size, and hands its terminal to one on screen;
// shown again it takes it back (`props.active`), exactly as a drawer tab did.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type ComponentType } from 'react'
import { createPortal } from 'react-dom'
import { createRoot } from 'react-dom/client'
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

/** What a terminal's view calls itself while it owns its terminal (`owners[pty].name`); `at` is
 *  the session host's key. */
export const viewName = (at: string) => `runtime:${at}`

const keyOf = (v: TerminalView) => (v.state === 'held' ? `held|${v.key}|${v.pty ?? ''}|${v.error ?? ''}` : v.state)

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
  const mount = document.createElement('div')
  park.appendChild(mount)
  document.body.appendChild(park)

  /** One box per hosted terminal, by its session's key (a tab changes its id when its session
   *  is learnt; its key stays): the view is drawn into it, wherever it stands. */
  const boxes = new Map<string, HTMLDivElement>()
  function boxOf(at: string): HTMLDivElement {
    let box = boxes.get(at)
    if (!box) {
      box = document.createElement('div')
      box.className = 'runtime-held'
      box.dataset.runtimeHeld = at
      park.appendChild(box)
      boxes.set(at, box)
    }
    return box
  }

  /** The terminal a `LiveTerminal` draws now, by its session's key. */
  const shown = createStore<{ at: string | null }>(() => ({ at: null }))

  function Held({ at, tab, pty }: { at: string; tab: string; pty: number }) {
    const here = useStore(shown, (s) => s.at === at)
    const close = useCallback(() => d.close(tab), [tab])
    const props = useMemo(() => ({ present: true, name: viewName(at), close, active: here }), [at, close, here])
    const Terminal = d.terminal
    return <Terminal id={pty} props={props} />
  }

  /** Every held terminal's view, each in its own box. */
  function Pool() {
    const tabs = useStore(d.nexus, (s) => s.tabs)
    const sessions = useStore(d.host, (h) => h.sessions)
    // One view per session, whichever tabs show it.
    const held = useMemo(() => {
      const first = new Map<string, string>()
      for (const t of tabs) if (t.key !== null && !first.has(t.key)) first.set(t.key, t.id)
      return [...first]
    }, [tabs])
    // A session that went takes its box with it.
    useEffect(() => {
      const open = new Set(held.map(([at]) => at))
      for (const [at, box] of boxes) {
        if (open.has(at)) continue
        box.remove()
        boxes.delete(at)
      }
    }, [held])
    return (
      <>
        {held.map(([at, tab]) => {
          const pty = sessions[at]?.pty ?? null
          return pty === null ? null : createPortal(<Held at={at} tab={tab} pty={pty} />, boxOf(at), at)
        })}
      </>
    )
  }

  const root = createRoot(mount)
  root.render(<Pool />)

  function focus(): boolean {
    const at = shown.getState().at
    const input = at === null ? null : boxes.get(at)?.querySelector<HTMLElement>('.xterm textarea')
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
    const at = view.state === 'held' && view.pty !== null ? view.key : null

    useLayoutEffect(() => {
      if (at === null || !slot.current) return
      const box = boxOf(at)
      slot.current.appendChild(box)
      shown.setState({ at })
      return () => {
        if (boxes.get(at) === box) park.appendChild(box)
        if (shown.getState().at === at) shown.setState({ at: null })
      }
    }, [at])

    // It takes the keys when it comes on stage active, and when it turns active.
    useEffect(() => {
      if (!active || at === null || typingElsewhere()) return
      const frame = requestAnimationFrame(() => void focus())
      return () => cancelAnimationFrame(frame)
    }, [active, at])

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
    LiveTerminal,
    focus,
    /** The session key of the terminal a `LiveTerminal` draws now, or null. */
    drawn: (): string | null => shown.getState().at,
    onDrawn: (fn: () => void): (() => void) => shown.subscribe(fn),
    dispose() {
      // Not while React is committing the tree that asked for the stop.
      setTimeout(() => {
        root.unmount()
        boxes.clear()
        park.remove()
      }, 0)
    },
  }
}
