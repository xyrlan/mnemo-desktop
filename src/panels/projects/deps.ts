// What the Projects panel reads and drives. The app's by default; a test provides its own.
// Sessions and shells start through `actions()`; this is the rest: the stores the ship's
// window read, the folder picker, and the one thing `Actions` does not carry, a command run
// in a terminal of the app (a saved command, a clone).

import { createContext } from 'react'
import type { StoreApi } from 'zustand/vanilla'
import { homeStore } from '../../home/app-store'
import { tauriHome } from '../../home/client'
import type { HomeSnapshot } from '../../home/types'
import { nexusRoutes } from '../../nexus/outside'
import { settingsStore } from '../../settings/app-store'
import type { SettingsState } from '../../settings/store'
import type { Outcome } from '../../world/actions'
import { worldSource } from '../../world/store'

export interface ProjectsDeps {
  /** Every repo the app knows (Claude's history, the saved projects), with its live sessions. */
  home: StoreApi<{ snapshot: HomeSnapshot; loading: boolean; load(): Promise<void> }>
  /** The saved projects, the hidden repos, the clone base and the saved commands. */
  settings: StoreApi<SettingsState>
  /** The system's folder picker; null when cancelled. */
  pickFolder(): Promise<string | null>
  /** The main checkout's root of the folder at `path`; rejects when it is not a git repository. */
  registerRepo(path: string): Promise<string>
  /** Runs `command` in a terminal of the app, in `root`, under the name `label`. */
  run(root: string, command: string, label: string): Promise<Outcome>
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export const appDeps: ProjectsDeps = {
  home: homeStore,
  settings: settingsStore,
  pickFolder: () => tauriHome.pickFolder(),
  registerRepo: (path) => tauriHome.registerRepo(path),
  // The app's own route for "a command in a terminal" (`src/nexus/outside.ts`), which whoever
  // hosts terminals sets. Outside a live world nothing leaves the page, as with `actions()`.
  async run(root, command, label) {
    if (worldSource() !== 'live') return { ok: true, note: 'The sample world runs no command.' }
    try {
      await nexusRoutes().terminal(root, command, label)
      return { ok: true }
    } catch (e) {
      return { ok: false, why: message(e) }
    }
  },
}

export const ProjectsDepsContext = createContext<ProjectsDeps>(appDeps)
