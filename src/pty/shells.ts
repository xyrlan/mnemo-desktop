/** The shell a new terminal pane starts on Windows, chosen among those installed (#360). The app
 *  asks `pty_shells` once at launch and after each choice; `paneShell` (`./typed`) reads `kind`
 *  here to type into a pane it has just spawned. On macOS and Linux nothing is offered: a pane
 *  starts `$SHELL`, and `kind` stays null. */

import type { Shell } from './typed'

export type ShellChoice = { id: string; label: string; kind: Shell; path: string }
export type Shells = { shells: ShellChoice[]; current: string | null; kind: Shell }

let known: Shells | null = null

/** What `pty_shells` last answered; null before it has. */
export const shells = (): Shells | null => known

/** How a pane spawned now is typed into, when the app has asked. */
export const newPaneKind = (): Shell | null => known?.kind ?? null

export function setShells(s: Shells | null) {
  known = s
}

/** Asks again, through `ask` (`invoke('pty_shells')`). A failure keeps what was known. */
export async function loadShells(ask: () => Promise<Shells>): Promise<Shells | null> {
  try {
    known = await ask()
  } catch {
    // Kept: a pane is then typed into as before, as cmd.
  }
  return known
}
