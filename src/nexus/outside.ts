/** Where what is asked for from inside the Nexus opens while it covers the workbench (spec
 *  `2026-10-15-nexus-app-design.md`, Q6; #451): a terminal in a drawer tab, a web page in the
 *  system browser, a vault page in the Memory window. Never a workbench tab, pane or view, which
 *  would open under the Nexus where nobody sees it.
 *
 *  The workbench's own paths (`github/actions`, `accounts/client`, `cockpit/approve`,
 *  `pulse/open`) ask `nexusRoutes()` first and go their usual way when it answers null: the Nexus
 *  closed, or never started. The Nexus sets the routes as it starts (`drawer/app.ts`). This module
 *  imports nothing, so any of those paths can ask it without an import cycle. */
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
