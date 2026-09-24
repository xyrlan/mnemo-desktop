import { createStore } from 'zustand/vanilla'
import { ARM_SCRIPT, TAKE_SCRIPT, TEARDOWN_SCRIPT } from './grab-guest'
import { formatGrab, parseTake, type GrabPayload } from './grab-payload'
import type { Snapshot } from './grab-shot'
import type { AgentTarget } from './grab-agent'

/** Design Mode, per browser pane: the page is armed with the grab overlay and polled until
 *  the user picks an element (or presses Escape); the pick is screenshotted and waits in the
 *  pane's card for a note, then goes to the worktree's agent. */

export type Shot = { state: 'taking' } | { state: 'ready'; path: string; data: string } | { state: 'none'; error: string }

export type Design =
  | { mode: 'picking'; error: string | null }
  | { mode: 'picked'; payload: GrabPayload; shot: Shot; sending: boolean; error: string | null }
  /** Just went to `title`; clears itself after SENT_MS. */
  | { mode: 'sent'; title: string }

export type DesignState = { panes: Record<number, Design> }

export type Deps = {
  /** Runs `script` in pane `id`'s page and answers WebKit's JSON of its value. */
  evaluate(id: number, script: string): Promise<string>
  snapshot(id: number): Promise<Snapshot>
  /** The element cut out of the snapshot, as base64 PNG. */
  crop(snap: Snapshot, payload: GrabPayload): Promise<string>
  /** Keeps the PNG where the agent can read it; answers its path. */
  save(id: number, png: string): Promise<string>
  target(): AgentTarget
  deliver(target: AgentTarget, text: string, shot: string | null): Promise<void>
  timers?: { set(f: () => void, ms: number): unknown; clear(t: unknown): void }
  /** How long a page gets to repaint without the overlay before it is captured. */
  repaintMs?: number
}

/** How often the page is asked whether an element was picked. */
export const POLL_MS = 200
/** How long "Sent to …" stays in the pane. */
export const SENT_MS = 2500

export function makeDesignMode(deps: Deps) {
  const store = createStore<DesignState>(() => ({ panes: {} }))
  const timers = deps.timers ?? { set: (f, ms) => setTimeout(f, ms), clear: (t) => clearTimeout(t as ReturnType<typeof setTimeout>) }
  const polls = new Map<number, unknown>()
  /** Bumped by every start and stop, so a poll or capture that outlived its run drops its answer. */
  const runs = new Map<number, number>()

  const get = (id: number) => store.getState().panes[id]
  const put = (id: number, d: Design | undefined) =>
    store.setState((s) => {
      const panes = { ...s.panes }
      if (d) panes[id] = d
      else delete panes[id]
      return { panes }
    })
  const bump = (id: number) => {
    const run = (runs.get(id) ?? 0) + 1
    runs.set(id, run)
    const t = polls.get(id)
    if (t !== undefined) timers.clear(t)
    polls.delete(id)
    return run
  }
  const current = (id: number, run: number) => runs.get(id) === run

  function schedule(id: number, run: number, ms = POLL_MS) {
    polls.set(
      id,
      timers.set(() => {
        polls.delete(id)
        void tick(id, run)
      }, ms),
    )
  }

  async function tick(id: number, run: number) {
    let take
    try {
      take = parseTake(await deps.evaluate(id, TAKE_SCRIPT))
    } catch {
      // The page is between documents or busy: ask again.
      if (current(id, run)) schedule(id, run)
      return
    }
    if (!current(id, run)) return
    switch (take.kind) {
      case 'waiting':
        return schedule(id, run)
      case 'unarmed':
        // A navigation took the overlay with the old document: lay it on the new one.
        await deps.evaluate(id, ARM_SCRIPT).catch(() => {})
        if (current(id, run)) schedule(id, run)
        return
      case 'error':
        put(id, { mode: 'picking', error: take.message })
        await deps.evaluate(id, ARM_SCRIPT).catch(() => {})
        if (current(id, run)) schedule(id, run)
        return
      case 'cancelled':
        bump(id)
        put(id, undefined)
        return
      case 'picked':
        bump(id)
        return capture(id, take.payload)
    }
  }

  async function capture(id: number, payload: GrabPayload) {
    const run = runs.get(id)!
    put(id, { mode: 'picked', payload, shot: { state: 'taking' }, sending: false, error: null })
    let shot: Shot
    try {
      // The overlay left the page as the click landed; let that reach the screen first.
      await new Promise<void>((r) => timers.set(r, deps.repaintMs ?? 80))
      const png = await deps.crop(await deps.snapshot(id), payload)
      shot = { state: 'ready', path: await deps.save(id, png), data: png }
    } catch (e) {
      shot = { state: 'none', error: String(e instanceof Error ? e.message : e) }
    }
    const d = get(id)
    if (current(id, run) && d?.mode === 'picked') put(id, { ...d, shot })
  }

  /** Arms the page and waits for a pick. */
  function start(id: number) {
    const run = bump(id)
    put(id, { mode: 'picking', error: null })
    void deps.evaluate(id, ARM_SCRIPT).then(
      () => current(id, run) && schedule(id, run),
      () => current(id, run) && schedule(id, run),
    )
  }

  /** Leaves Design Mode: the overlay comes off the page and any pick is dropped. */
  function stop(id: number) {
    if (!get(id)) return
    bump(id)
    put(id, undefined)
    void deps.evaluate(id, TEARDOWN_SCRIPT).catch(() => {})
  }

  /** The write-up for the pick in pane `id` with `note`, or null when nothing is picked. */
  function text(id: number, note: string): string | null {
    const d = get(id)
    if (d?.mode !== 'picked') return null
    const shot = d.shot.state === 'ready' ? { path: d.shot.path } : { error: d.shot.state === 'none' ? d.shot.error : 'still being taken' }
    return formatGrab(d.payload, note, shot)
  }

  return {
    store,
    start,
    stop,
    toggle: (id: number) => (get(id) && get(id)!.mode !== 'sent' ? stop(id) : start(id)),
    text,
    /** Sends the pick with `note` to the worktree's agent. Resolves true once it went; on
     *  failure the card stays with the reason. */
    async send(id: number, note: string): Promise<boolean> {
      const d = get(id)
      if (d?.mode !== 'picked' || d.sending) return false
      const run = runs.get(id)
      const target = deps.target()
      put(id, { ...d, sending: true, error: null })
      const shot = d.shot.state === 'ready' ? d.shot.path : null
      try {
        await deps.deliver(target, text(id, note)!, shot)
      } catch (e) {
        const now = get(id)
        if (current(id, run!) && now?.mode === 'picked') put(id, { ...now, sending: false, error: String(e instanceof Error ? e.message : e) })
        return false
      }
      if (current(id, run!)) {
        bump(id)
        put(id, { mode: 'sent', title: target.kind === 'none' ? '' : target.title })
        // Kept with the polls, so a start or stop in the meantime cancels it.
        polls.set(
          id,
          timers.set(() => {
            polls.delete(id)
            put(id, undefined)
          }, SENT_MS),
        )
      }
      return true
    },
  }
}

export type DesignMode = ReturnType<typeof makeDesignMode>
