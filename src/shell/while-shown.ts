/** Polls whose answer only the window shows. While the window is hidden (minimised, or behind
 *  another space) nobody reads what they fetch, so they wait, or slow down, and catch up the
 *  moment it shows again. The mission poll (`mission-poll.ts`) and the Checks tab
 *  (`checks/live.ts`) did this on their own; every other poll goes through here. */

/** Whether the window is hidden, and a way to hear it shown again. */
export type Shown = {
  hidden(): boolean
  /** Calls `cb` each time the window shows again; returns the way to stop listening. */
  onShow(cb: () => void): () => void
}

/** The page's own visibility. With no document (a test in node) the window always shows. */
export const windowShown: Shown = {
  hidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
  onShow(cb) {
    if (typeof document === 'undefined') return () => {}
    const on = () => {
      if (document.visibilityState !== 'hidden') cb()
    }
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  },
}

export type PollOpts = {
  /** While hidden, poll this often instead of not at all. */
  hiddenMs?: number
  /** Leave the first poll to `ms` from now; by default it runs at once. */
  wait?: boolean
  shown?: Shown
}

/** Runs `tick` now and every `ms` after the last one ends. While the window is hidden it waits
 *  (or runs every `hiddenMs`); when it shows again, a poll that is due runs at once. Two ticks
 *  never overlap, and a tick that throws or rejects does not stop it. Returns the way to stop. */
export function pollWhileShown(tick: () => unknown, ms: number, opts: PollOpts = {}): () => void {
  const shown = opts.shown ?? windowShown
  let stopped = false
  let running = false
  let timer: ReturnType<typeof setTimeout> | undefined
  // When the last tick started; a wait counts as one, so the first is due `ms` later.
  let last = Date.now()

  const schedule = () => {
    clearTimeout(timer)
    if (!stopped) timer = setTimeout(fire, shown.hidden() ? (opts.hiddenMs ?? ms) : ms)
  }
  const run = () => {
    if (running || stopped) return
    clearTimeout(timer)
    running = true
    last = Date.now()
    void (async () => {
      try {
        await tick()
      } catch {
        // The poll's owner keeps its last answer and says why itself.
      }
      running = false
      schedule()
    })()
  }
  const fire = () => {
    if (shown.hidden() && opts.hiddenMs === undefined) return schedule()
    run()
  }
  const off = shown.onShow(() => {
    if (Date.now() - last >= ms) run()
  })

  if (opts.wait) schedule()
  else run()
  return () => {
    stopped = true
    clearTimeout(timer)
    off()
  }
}
