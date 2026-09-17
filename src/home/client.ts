import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import type { HomeSnapshot } from './types'

export interface HomeClient {
  snapshot(args: { here: string[]; pinned: string[]; hidden: string[]; extraRoots: string[] }): Promise<HomeSnapshot>
  /** Main-checkout root of a folder, or rejects with "não é um repositório git". */
  registerRepo(path: string): Promise<string>
  /** Runs git in an unresolved repo's path (macOS may ask, once) and returns its main-checkout
   *  root; rejects with "não é um repositório git" or a permission message. */
  resolveRepo(root: string): Promise<string>
  /** Native directory picker; null when cancelled. */
  pickFolder(): Promise<string | null>
}

/** Fetch every listed repo's open issues and PRs through `gh`; the next `home_snapshot`
 *  carries them. GitHub is read only when this is called, never on the snapshot's poll. */
export const refreshGithub = (): Promise<void> => invoke('home_refresh_github')

export const tauriHome: HomeClient = {
  snapshot: (a) => invoke('home_snapshot', a),
  registerRepo: (path) => invoke('home_register_repo', { path }),
  resolveRepo: (root) => invoke('home_resolve_repo', { root }),
  pickFolder: async () => {
    const r = await open({ directory: true, multiple: false })
    return typeof r === 'string' ? r : null
  },
}
