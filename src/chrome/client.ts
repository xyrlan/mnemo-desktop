import { invoke } from '@tauri-apps/api/core'

export interface ChromeClient {
  /** Branch checked out in `cwd` (short commit when detached), null outside a repo. */
  branch(cwd: string): Promise<string | null>
  /** Name of the repository `cwd` is in (a worktree reports its main checkout), null outside one. */
  repo(cwd: string): Promise<string | null>
}

export const tauriChrome: ChromeClient = {
  branch: (cwd) => invoke<string | null>('chrome_branch', { cwd }),
  repo: (cwd) => invoke<string | null>('chrome_repo', { cwd }),
}
