import type { Agent, Page, RunResult } from './types'

export type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>

export interface VaultClient {
  /** Every agent with pages: `shared`, then repos, then `other`. Empty when there is no vault. */
  tree(): Promise<Agent[]>
  page(path: string): Promise<Page>
  /** `mnemo <action> <args>` in `cwd`; the Rust side refuses anything off its allowlist. */
  run(action: string, args: string[], cwd: string): Promise<RunResult>
}

export function makeVaultClient(invoke: Invoke): VaultClient {
  return {
    tree: () => invoke<Agent[]>('vault_tree'),
    page: (path) => invoke<Page>('vault_page', { path }),
    run: (action, args, cwd) => invoke<RunResult>('vault_run', { action, args, cwd }),
  }
}
