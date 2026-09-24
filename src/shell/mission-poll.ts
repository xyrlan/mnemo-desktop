/** The mission snapshot poll every mission surface reads (pane bars' tokens, the mission and
 *  cockpit panes, the status bar): what `src/mission/Sidebar.tsx` ran while it was mounted.
 *  The shell no longer mounts that sidebar, so the shell runs it. The fleet's own 30 s poll is
 *  its fallback, not this. */

/** Between refreshes while the window is visible, and while it is hidden. */
export const VISIBLE_MS = 3000
export const HIDDEN_MS = 15000
/** PRs and checks come through `gh`, slowly: on the first refresh and every this many. */
export const PRS_EVERY = 10

export type MissionPollSources = {
  refresh(withPrs: boolean): Promise<void>
  /** The cockpit's "looked at" marks, read once. */
  loadLooked(): Promise<void>
  hidden(): boolean
}

/** Starts polling; returns the way to stop. A refresh in flight when stopped schedules nothing. */
export function startMissionPoll(src: MissionPollSources): () => void {
  let tick = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  const loop = async () => {
    const withPrs = tick % PRS_EVERY === 0
    tick++
    try {
      await src.refresh(withPrs)
    } catch {
      // The store keeps its last snapshot and says why itself.
    }
    if (!stopped) timer = setTimeout(loop, src.hidden() ? HIDDEN_MS : VISIBLE_MS)
  }
  void src.loadLooked().catch(() => {})
  void loop()
  return () => {
    stopped = true
    clearTimeout(timer)
  }
}
