import { createContext } from 'react'
import type { StoreApi } from 'zustand/vanilla'
import { homeStore } from '../../../home/app-store'
import { tauriHome } from '../../../home/client'
import type { HomeSnapshot } from '../../../home/types'
import { settingsStore } from '../../../settings/app-store'
import type { SettingsState } from '../../../settings/store'
import { openSession, type SessionSpec } from '../../drawer/open'

/** What the PROJECTS window reads and drives. The app's by default; a test provides its own. */
export type ProjectsDeps = {
  /** Every repo the app knows (Claude's history, the saved projects), with its live sessions. */
  home: StoreApi<{ snapshot: HomeSnapshot; loading: boolean; load(): Promise<void> }>
  /** The saved projects, the hidden repos, the clone base and the saved commands. */
  settings: StoreApi<SettingsState>
  /** The system's folder picker; null when cancelled. */
  pickFolder(): Promise<string | null>
  /** The main checkout's root of the folder at `path`; rejects when it is not a git repository. */
  registerRepo(path: string): Promise<string>
  openSession(spec: SessionSpec): Promise<void>
}

export const appDeps: ProjectsDeps = {
  home: homeStore,
  settings: settingsStore,
  pickFolder: () => tauriHome.pickFolder(),
  registerRepo: (path) => tauriHome.registerRepo(path),
  openSession: (spec) => openSession(spec),
}

export const ProjectsDepsContext = createContext<ProjectsDeps>(appDeps)
