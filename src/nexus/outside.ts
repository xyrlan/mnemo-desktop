/** Where what is asked for from inside the Nexus opens while it covers the workbench (spec
 *  `2026-10-15-nexus-app-design.md`, Q6; #451): a terminal in a drawer tab, a web page in the
 *  system browser, a vault page in the Memory window. Never a workbench tab, pane or view, which
 *  would open under the Nexus where nobody sees it.
 *
 *  The workbench's own paths (`github/actions`, `accounts/client`, `cockpit/approve`,
 *  `pulse/open`) ask `nexusRoutes()` first and go their usual way when it answers null: the Nexus
 *  closed, or never started. The Nexus sets the routes as it starts (`drawer/app.ts`). This module
 *  imports nothing at run time, so any of those paths can ask it without an import cycle. */
import type { Target } from '../mission/account'

export type NexusRoutes = {
  /** Runs `command` in a drawer tab named `label`, in `cwd` (the home folder when undefined). */
  terminal(cwd: string | undefined, command: string, label: string): Promise<void>
  /** Opens an http(s) page in the system browser; rejects for anything else. */
  page(url: string): Promise<void>
  /** Shows the vault's pages in the Memory window: the page selected, or the search typed. */
  pages(): void
}

let routes: NexusRoutes | null = null
let shown: () => boolean = () => false

/** Sets the routes, used while `isOpen()` says the Nexus covers the workbench. Returns the unset. */
export function setNexusRoutes(r: NexusRoutes, isOpen: () => boolean): () => void {
  routes = r
  shown = isOpen
  return () => {
    if (routes !== r) return
    routes = null
    shown = () => false
  }
}

/** The routes while the Nexus is open, else null. */
export const nexusRoutes = (): NexusRoutes | null => (routes && shown() ? routes : null)

/** What opens a session's figure in the Nexus from anywhere in the app (wave 2a, `routes`): a
 *  notification's click, the mission pane's attach. The Nexus sets it as it mounts (`NexusView`). */
export type Figures = {
  /** Opens figure `id` (a robot's short id, a captain's session id) in its drawer tab, the Nexus
   *  open, as a click on it does; false when the ship does not know it. */
  open(id: string): boolean
  /** Holds `claude attach` to dispatched child `child`, on its account, in a drawer tab, the Nexus
   *  open: its robot's tab when the ship knows it. */
  attach(child: Target): void
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

/** Attaches dispatched child `child` in a drawer tab; false when there is no Nexus to attach it in. */
export function attachInNexus(child: Target): boolean {
  if (!figures) return false
  figures.attach(child)
  return true
}
