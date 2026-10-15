/** Where what is asked for from anywhere in the app opens (spec `2026-10-15-nexus-app-design.md`,
 *  Q6; #451): a terminal in a drawer tab, a web page in the system browser, a vault page in the
 *  Memory window.
 *
 *  The app's paths (`github/actions`, `accounts/client`, `cockpit/approve`, `pulse/open`) ask
 *  `nexusRoutes()`. The Nexus sets the routes as it loads (`./outside-app`); until then, and in a
 *  test that sets none, each route refuses. This module imports nothing at run time, so any of
 *  those paths can ask it without an import cycle. */

export type NexusRoutes = {
  /** Runs `command` in a drawer tab named `label`, in `cwd` (the home folder when undefined). */
  terminal(cwd: string | undefined, command: string, label: string): Promise<void>
  /** Opens an http(s) page in the system browser; rejects for anything else. */
  page(url: string): Promise<void>
  /** Shows the vault's pages in the Memory window: the page selected, or the search typed. */
  pages(): void
}

/** What every route does before the Nexus has set its own: refuses, and opens nothing. */
const UNSET: NexusRoutes = {
  terminal: () => Promise.reject(new Error('the Nexus has not started')),
  page: () => Promise.reject(new Error('the Nexus has not started')),
  pages: () => {},
}

let routes: NexusRoutes = UNSET

/** Sets the routes. Returns the unset. */
export function setNexusRoutes(r: NexusRoutes): () => void {
  routes = r
  return () => {
    if (routes === r) routes = UNSET
  }
}

/** The routes the Nexus set. */
export const nexusRoutes = (): NexusRoutes => routes

/** What opens a session's figure in the Nexus from anywhere in the app (wave 2a, `routes`): a
 *  notification's click. The Nexus sets it as it mounts (`NexusView`). */
export type Figures = {
  /** Opens figure `id` (a robot's short id, a captain's session id) in its drawer tab, as a click on
   *  it does; false when the ship does not know it. */
  open(id: string): boolean
}

let figures: Figures | null = null

/** Sets what opens figures. Returns the unset. */
export function setFigures(f: Figures): () => void {
  figures = f
  return () => {
    if (figures === f) figures = null
  }
}

/** Opens a robot's or a captain's drawer tab from anywhere in the app, as a click on it does. False
 *  when the ship does not know the id, or there is no Nexus to open it in. */
export function openFigure(id: string): boolean {
  return figures?.open(id) ?? false
}
