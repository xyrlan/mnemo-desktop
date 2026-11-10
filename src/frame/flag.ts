// Which front a build shows (docs/superpowers/specs/2026-11-10-recreation-swap.md). The new
// front is the app; the ship stays in the build one release as the way back, and one action
// brings it: `localStorage['mnemo.next'] = '0'`. `'1'` (or `?next` on the URL) asks for the new
// front outright, whatever the default is.

const KEY = 'mnemo.next'

/** Under vitest the default is the ship, so the ship's own tests keep meaning what they meant;
 *  a test of the new front says `'1'`. */
const inTest = (): boolean => import.meta.env?.MODE === 'test'

/** What the flag says, read apart from where it is kept: `'0'` is the ship, `'1'` (or `forced`,
 *  the URL's `?next`) the new front, and anything else is `fallback`. */
export function frontOf(kept: string | null, forced: boolean, fallback: boolean): boolean {
  if (forced || kept === '1') return true
  if (kept === '0') return false
  return fallback
}

export function nextFront(): boolean {
  try {
    return frontOf(localStorage.getItem(KEY), new URLSearchParams(location.search).has('next'), !inTest())
  } catch {
    // No window, or storage refused: what a build shows.
    return !inTest()
  }
}

/** Why the switch did not go through, or null when it did. */
export type Switched = string | null

/** Shows the other front from now on: keeps the choice and loads the app again, which is when
 *  each front decides whether it mounts. The terminals are the core's and stay as they are; the
 *  app restores them as it does at any launch. `reload` is the page's own, unless a test hands
 *  one in. */
export function showFront(next: boolean, reload: () => void = () => location.reload()): Switched {
  try {
    localStorage.setItem(KEY, next ? '1' : '0')
    // `?next` on the URL would bring the new front straight back.
    const url = new URL(location.href)
    if (!next && url.searchParams.has('next')) {
      url.searchParams.delete('next')
      history.replaceState(null, '', url)
    }
  } catch (e) {
    return `The choice could not be kept: ${e instanceof Error ? e.message : String(e)}`
  }
  reload()
  return null
}

/** The ship, from the new front: "Classic interface". */
export const showClassic = (reload?: () => void): Switched => showFront(false, reload)
