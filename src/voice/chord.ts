/** ⌥Space (Alt+Space elsewhere), matched on `code`: on macOS ⌥Space reports `key` as a
 *  non-breaking space. */
export function isDictationChord(e: KeyboardEvent): boolean {
  return e.code === 'Space' && e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey
}

/** Push-to-talk: press begins, releasing Space or ⌥ ends. Listens in the capture phase so
 *  neither xterm nor Monaco sees the chord; losing window focus mid-take also ends it, or
 *  the microphone would stay open with no key left to release. */
export function installChord(voice: { begin(): void; end(): unknown }, target: Window = window): () => void {
  let held = false
  const release = () => {
    held = false
    void voice.end()
  }
  const down = (e: KeyboardEvent) => {
    if (!isDictationChord(e)) return
    e.preventDefault()
    e.stopPropagation()
    if (held || e.repeat) return
    held = true
    voice.begin()
  }
  const up = (e: KeyboardEvent) => {
    if (!held || (e.code !== 'Space' && e.key !== 'Alt')) return
    e.preventDefault()
    e.stopPropagation()
    release()
  }
  const blur = () => {
    if (held) release()
  }
  target.addEventListener('keydown', down, true)
  target.addEventListener('keyup', up, true)
  target.addEventListener('blur', blur)
  return () => {
    target.removeEventListener('keydown', down, true)
    target.removeEventListener('keyup', up, true)
    target.removeEventListener('blur', blur)
  }
}
