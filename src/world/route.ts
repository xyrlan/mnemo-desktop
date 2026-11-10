// Where the maintainer is: which view, which session, which reading. Kept in the hash, so a
// state has a URL (the preview harness photographs it, a reload returns to it), and shared by
// every view, so the selection in one is the selection in the others.

import { create } from 'zustand'

export type View = 'orbit' | 'console' | 'score'
export type Reading = 'context' | 'memory' | 'sight'
export type PanelId = 'projects' | 'missions' | 'memory' | 'learned' | 'setup' | 'accounts' | 'settings' | 'changes'

export interface Route {
  view: View
  /** The selected session's id, in every view. */
  session: string | null
  /** The instrument in front when there is room for one. */
  reading: Reading
  /** Score's playhead, epoch ms; null is now. */
  at: number | null
  /** The waiting item whose card is open. */
  pending: string | null
  panel: PanelId | null
  /** The terminal has the room. */
  wide: boolean
  /** The command line is open. */
  command: boolean
}

export const HOME: Route = { view: 'orbit', session: null, reading: 'context', at: null, pending: null, panel: null, wide: false, command: false }

const VIEWS: View[] = ['orbit', 'console', 'score']
const READINGS: Reading[] = ['context', 'memory', 'sight']

export function parse(hash: string): Route {
  const q = new URLSearchParams(hash.replace(/^#/, ''))
  const view = q.get('v') as View
  const reading = q.get('r') as Reading
  const at = Number(q.get('at'))
  return {
    view: VIEWS.includes(view) ? view : HOME.view,
    session: q.get('s'),
    reading: READINGS.includes(reading) ? reading : HOME.reading,
    at: q.get('at') && Number.isFinite(at) ? at : null,
    pending: q.get('p'),
    panel: (q.get('panel') as PanelId) || null,
    wide: q.get('wide') === '1',
    command: q.get('cmd') === '1',
  }
}

export function format(r: Route): string {
  const q = new URLSearchParams()
  q.set('v', r.view)
  if (r.session) q.set('s', r.session)
  if (r.reading !== HOME.reading) q.set('r', r.reading)
  if (r.at != null) q.set('at', String(r.at))
  if (r.pending) q.set('p', r.pending)
  if (r.panel) q.set('panel', r.panel)
  if (r.wide) q.set('wide', '1')
  if (r.command) q.set('cmd', '1')
  return '#' + q.toString()
}

interface RouteState {
  route: Route
  /** Sessions that were selected, most recent first: what "the session you were on" walks. */
  recent: string[]
  go(patch: Partial<Route>): void
}

const KEY = 'mnemo.route'

/** The hash when the URL has one, else where the maintainer was when the app last ran. */
const initial = (): Route => {
  try {
    return parse(location.hash.length > 1 ? location.hash : (localStorage.getItem(KEY) ?? ''))
  } catch {
    return HOME
  }
}

export const routeStore = create<RouteState>((set, get) => ({
  route: initial(),
  recent: [],
  go(patch) {
    const route = { ...get().route, ...patch }
    const before = get().recent
    const recent = route.session && route.session !== before[0] ? [route.session, ...before.filter((id) => id !== route.session)].slice(0, 24) : before
    set({ route, recent })
    try {
      const hash = format(route)
      if (location.hash !== hash) history.replaceState(null, '', hash)
      localStorage.setItem(KEY, hash)
    } catch {
      // no window: the store is the route
    }
  },
}))

export function useRoute<T>(pick: (route: Route) => T): T {
  return routeStore((s) => pick(s.route))
}

export const go = (patch: Partial<Route>): void => routeStore.getState().go(patch)

/** Select a session where the maintainer is. */
export const select = (session: string | null): void => go({ session, pending: null })

/** Put a session on Console's stage: what opening it means in every view. */
export const openOnStage = (session: string): void => go({ view: 'console', session, pending: null, panel: null })
