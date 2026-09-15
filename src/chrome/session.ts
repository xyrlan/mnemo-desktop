import { useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { store as appStore, useApp } from '../layout/app-store'
import type { Store } from '../layout/store'
import type { PaneId } from '../layout/tree'
import { ptyPid } from '../pty/client'

/** How often a terminal pane asks which Claude session it runs, on screen or not: the workspace
 *  restore resumes every tab, so a hidden one must be as current as the visible one. */
export const SESSION_POLL_MS = 5000

export interface SessionClient {
  /** The pid of the pane's shell, null once it has exited. */
  pid(id: PaneId): Promise<number | null>
  /** The Claude Code session running under that shell, null when there is none. */
  session(panePid: number): Promise<string | null>
}

export const tauriSession: SessionClient = {
  pid: ptyPid,
  session: (panePid) => invoke<string | null>('chrome_session', { panePid }),
}

/** A pane's `sessionId` after one look at its process tree. A session seen live replaces
 *  whatever the pane had and is cleared when it ends; an id the pane was opened or restored
 *  with stays until a Claude shows up (its `claude --resume` may not have started yet). */
export function nextSession(current: string | undefined, found: string | null, learnt: boolean): { sessionId: string | undefined; learnt: boolean } {
  if (found) return { sessionId: found, learnt: true }
  return { sessionId: learnt ? undefined : current, learnt: false }
}

/** Per layout store: panes whose `sessionId` was seen live, and shell pids (a pane's never
 *  changes). Pane ids are never reused within a store. */
const memo = new WeakMap<Store, { learnt: Set<PaneId>; pids: Map<PaneId, number> }>()
const memoOf = (layout: Store) => {
  let m = memo.get(layout)
  if (!m) memo.set(layout, (m = { learnt: new Set(), pids: new Map() }))
  return m
}

/** Asks once which session terminal pane `id` runs and records it in the layout store. */
export async function learnSession(id: PaneId, client: SessionClient, layout: Store = appStore): Promise<void> {
  const live = () => {
    const p = layout.getState().panes[id]
    return p?.view === 'terminal' && p.exitCode === undefined && !p.error ? p : undefined
  }
  if (id <= 0 || !live()) return
  const { learnt, pids } = memoOf(layout)
  let pid = pids.get(id)
  if (pid === undefined) {
    const got = await client.pid(id)
    if (got == null) return
    pids.set(id, (pid = got))
  }
  const found = await client.session(pid)
  const pane = live()
  if (!pane) {
    learnt.delete(id)
    pids.delete(id)
    return
  }
  const next = nextSession(pane.sessionId, found, learnt.has(id))
  if (next.learnt) learnt.add(id)
  else learnt.delete(id)
  if (next.sessionId !== pane.sessionId) layout.getState().setSessionId(id, next.sessionId)
}

/** Keeps pane `id`'s `sessionId` in step with the `claude` running in it while it is mounted. */
export function useSessionLearn(id: PaneId, client: SessionClient = tauriSession) {
  const terminal = useApp((s) => s.panes[id]?.view === 'terminal' && s.panes[id]?.exitCode === undefined)
  useEffect(() => {
    if (!terminal || id <= 0) return
    let busy = false
    const tick = () => {
      if (busy) return
      busy = true
      learnSession(id, client)
        .catch(() => {})
        .finally(() => (busy = false))
    }
    tick()
    const timer = setInterval(tick, SESSION_POLL_MS)
    return () => clearInterval(timer)
  }, [id, terminal, client])
}
