// The runtime: what makes the new front act on real sessions. It hosts terminals, implements
// `Actions` over the paths the app already has, and starts what the ship's view used to start
// (docs/superpowers/specs/2026-11-10-recreation-design.md, "What stays of the core and the
// front"). It runs only in a live world: until `startRuntime` is called nothing is hosted, and
// this module loads none of the app (`./live` is loaded by the start).
//
//   ./hosting    which terminal shows a session, and when it is held
//   ./Terminals  the held terminals' views, and the one on stage
//   ./actions    `Actions` over the app's paths; ./pane-keys, ./stop, ./rows are its parts
//   ./live       the real stores and paths, and what the ship's view started

import { useMemo, useSyncExternalStore } from 'react'
import { useStore } from 'zustand'
import type { Session } from '../world/types'
import { runtimeStore } from './current'
import type { Hosted } from './hosting'

export type { Hosted } from './hosting'

/** Whether the stage can show this session's terminal live, here and now: one of the app's own
 *  terminals runs it, or it is a live background child the app can attach to. Read in a render;
 *  it changes with the world, and when `actions().open` resolves (`useCanHost` hears both). */
export function canHost(session: Session): boolean {
  return runtimeStore.getState().runtime?.canHost(session) ?? false
}

/** The session's real terminal. `active`: it is the one on stage and takes the keys. Only
 *  rendered for a session `canHost` accepts. It fills the box it is given.
 *
 *  `sessionId` is a session's id, or the id of a terminal the app holds that is no session of
 *  the world (a shell, a command: `useHosted`). */
export function LiveTerminal({ sessionId, active }: { sessionId: string; active: boolean }) {
  const runtime = useStore(runtimeStore, (s) => s.runtime)
  if (!runtime) return <div data-live-terminal={sessionId} data-active={active || undefined} />
  const Terminal = runtime.Terminal
  return <Terminal sessionId={sessionId} active={active} />
}

let started: { count: number; stop: () => void } | null = null

/** Start the runtime in a live world: set the real `Actions`, restore the hosted sessions,
 *  keep the tab state the desktop MCP, dictation and notifications read. Returns how to stop.
 *  Each call is counted, so a second start (StrictMode's double effect) runs nothing twice and
 *  only the last stop stops it. */
export function startRuntime(): () => void {
  if (!started) started = { count: 0, stop: load() }
  started.count++
  let stopped = false
  return () => {
    if (stopped || !started) return
    stopped = true
    if (--started.count > 0) return
    started.stop()
    started = null
  }
}

/** The app's wiring, asked for once: every start waits on the same load. A load that failed is
 *  asked for again by the next start. */
let wiring: Promise<typeof import('./live')> | null = null
const wired = () =>
  (wiring ??= import('./live').catch((e: unknown) => {
    wiring = null
    throw e
  }))

function load(): () => void {
  let stop: (() => void) | null = null
  let cancelled = false
  void wired().then(
    (live) => {
      if (!cancelled) stop = live.start()
    },
    (e: unknown) => console.error('mnemo: the runtime did not start', e),
  )
  return () => {
    cancelled = true
    stop?.()
    stop = null
  }
}

const hear = (fn: () => void) => {
  let off = runtimeStore.getState().runtime?.subscribe(fn)
  const unwatch = runtimeStore.subscribe((s) => {
    off?.()
    off = s.runtime?.subscribe(fn)
    fn()
  })
  return () => {
    unwatch()
    off?.()
  }
}

/** `canHost`, heard: true the moment the session's terminal can be shown, with no world change. */
export function useCanHost(session: Session | null | undefined): boolean {
  return useSyncExternalStore(hear, () => (session ? canHost(session) : false))
}

/** Every terminal the app holds, in the order they were opened: the sessions on their own
 *  terminals, and the shells and commands that are no session of the world (`kind: 'session'`).
 *  `LiveTerminal` draws any of them by `id`. */
export function useHosted(): Hosted[] {
  const key = useSyncExternalStore(hear, () => JSON.stringify(runtimeStore.getState().runtime?.hosted() ?? []))
  return useMemo(() => JSON.parse(key) as Hosted[], [key])
}

/** Gives the keyboard to the terminal on stage (the frame's Enter). False when there is none. */
export function focusTerminal(): boolean {
  return runtimeStore.getState().runtime?.focus() ?? false
}
