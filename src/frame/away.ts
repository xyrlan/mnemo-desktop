// Still when nobody is looking. The app sits open all day beside builds and a speech model;
// measured at rest, what it costs is not its own work but the frames its motion asks for (the
// lattice's loop, the state marks' pulse: 14 to 25% of one core, tools/perf/README.md). So
// when the window has been out of focus for a while, or is hidden, the frame marks its root
// `data-away`: every CSS animation under it pauses (tokens.css) and the lattice draws one still
// (it listens for `mnemo:away`). The moment the window is focused or touched, it all resumes.
// What waits for the maintainer while he is away is the notification's to say, not a blink.

/** How long the window may be out of focus before its motion stops. */
export const AWAY_AFTER_MS = 20_000

/** What `data-away` follows. Exported for the lattice and for tests. */
export const AWAY_EVENT = 'mnemo:away'

/** Mark `root` while the maintainer is away. Returns how to stop. */
export function watchAway(root: HTMLElement, after = AWAY_AFTER_MS): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const set = (away: boolean) => {
    if (root.hasAttribute('data-away') === away) return
    if (away) root.setAttribute('data-away', '')
    else root.removeAttribute('data-away')
    window.dispatchEvent(new CustomEvent(AWAY_EVENT, { detail: away }))
  }
  const here = () => {
    clearTimeout(timer)
    timer = undefined
    set(false)
  }
  const left = () => {
    clearTimeout(timer)
    timer = setTimeout(() => set(true), after)
  }
  const seen = () => (document.hidden ? (clearTimeout(timer), set(true)) : document.hasFocus() ? here() : left())

  window.addEventListener('focus', here)
  window.addEventListener('blur', left)
  window.addEventListener('pointerdown', here, true)
  window.addEventListener('keydown', here, true)
  document.addEventListener('visibilitychange', seen)
  if (document.hidden) set(true)
  else if (!document.hasFocus()) left()
  return () => {
    clearTimeout(timer)
    window.removeEventListener('focus', here)
    window.removeEventListener('blur', left)
    window.removeEventListener('pointerdown', here, true)
    window.removeEventListener('keydown', here, true)
    document.removeEventListener('visibilitychange', seen)
    set(false)
  }
}
