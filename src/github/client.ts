import { invoke } from '@tauri-apps/api/core'
import type { Auth, Board, Issue } from './types'

export interface GithubClient {
  auth(): Promise<Auth>
  issues(root: string, labels: string[]): Promise<Issue[]>
  /** Rejects with `needs_scope` when the token lacks the `project` scope. */
  project(root: string): Promise<Board | null>
}

export const tauriGithub: GithubClient = {
  auth: () => invoke('gh_auth'),
  issues: (root, labels) => invoke('gh_issues', { root, labels }),
  project: (root) => invoke('gh_project', { root }),
}
