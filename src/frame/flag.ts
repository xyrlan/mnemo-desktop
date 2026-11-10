// Which front a build shows. Until the swap the ship is the app; `localStorage['mnemo.next'] =
// '1'` (or `?next` on the URL) shows the new front instead, in a dev build or an installed one.

export function nextFront(): boolean {
  try {
    return new URLSearchParams(location.search).has('next') || localStorage.getItem('mnemo.next') === '1'
  } catch {
    return false
  }
}
