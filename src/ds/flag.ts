// The gallery page: every primitive in every state, on the synthetic world. It is drawn over
// whatever front the build shows, from a root of its own (src/ds/view.tsx), when
// `localStorage['mnemo.ds']` names a page (or `?ds=<page>` is on the URL), in a dev build or
// an installed one. The preview scenarios `next-ds*` set it.

export const PAGES = ['identity', 'sessions', 'readings'] as const
export type GalleryPage = (typeof PAGES)[number]

/** The page asked for, or null when the gallery is not. Anything that is not a page's name
 *  (`1`, an old name) is the first page. */
export function galleryPage(): GalleryPage | null {
  let asked: string | null = null
  try {
    const query = new URLSearchParams(location.search)
    asked = query.has('ds') ? query.get('ds') : localStorage.getItem('mnemo.ds')
  } catch {
    return null
  }
  if (asked === null) return null
  return (PAGES as readonly string[]).includes(asked) ? (asked as GalleryPage) : PAGES[0]
}

/** Whether the gallery opens with motion stilled (`localStorage['mnemo.ds.motion'] = 'reduced'`). */
export function galleryStill(): boolean {
  try {
    return localStorage.getItem('mnemo.ds.motion') === 'reduced'
  } catch {
    return false
  }
}
