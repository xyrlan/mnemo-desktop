/** The Nexus's own use, for the measure that credits it (spec Q26): `{event: 'nexus.open'}` when
 *  the drawer opens, and `{event: 'nexus.visible', ms}` for the time it stayed on screen with the
 *  window focused, at least every `BEAT_MS` while open and once more on close. Rows go to
 *  `~/.mnemo-desktop/usage.jsonl` through `usage_log`; nothing leaves the machine. mnemo's measure
 *  tool reads these rows, so their names are fixed.
 *
 *  Returns the stop the drawer calls when it closes. A `visible` row carries the time since the
 *  last one, so the rows add up to the whole. The beat runs only while the drawer is seen: losing
 *  focus or going hidden writes what was seen so far and stops it, and nothing seen writes no row. */
export const BEAT_MS = 30_000

export function startNexusUsage(log: (row: Record<string, unknown>) => void, now: () => number): () => void {
  log({ event: 'nexus.open' })
  // Focus is followed by its events: inside a `blur` handler `hasFocus()` may still say true.
  let focused = document.hasFocus()
  /** On screen and focused: a hidden or background window is not looked at. */
  const seen = () => focused && document.visibilityState === 'visible'
  let since: number | null = null
  let beat: ReturnType<typeof setTimeout> | null = null

  const flush = () => {
    if (since === null) return
    const t = now()
    const ms = Math.round(t - since)
    since = t
    if (ms > 0) log({ event: 'nexus.visible', ms })
  }
  const arm = () => {
    beat = setTimeout(() => {
      flush()
      arm()
    }, BEAT_MS)
  }
  const resume = () => {
    if (since !== null) return
    since = now()
    arm()
  }
  const pause = () => {
    flush()
    since = null
    if (beat !== null) clearTimeout(beat)
    beat = null
  }
  const changed = () => (seen() ? resume() : pause())
  const onFocus = () => {
    focused = true
    changed()
  }
  const onBlur = () => {
    focused = false
    changed()
  }

  changed()
  window.addEventListener('focus', onFocus)
  window.addEventListener('blur', onBlur)
  document.addEventListener('visibilitychange', changed)
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    window.removeEventListener('focus', onFocus)
    window.removeEventListener('blur', onBlur)
    document.removeEventListener('visibilitychange', changed)
    pause()
  }
}
