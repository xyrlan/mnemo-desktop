import type { Agent, Health, Page, RuleRow, RunResult, VaultGraph } from './types'

export type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>

export interface VaultClient {
  /** Every agent with pages: `shared`, then repos, then `other`. Empty when there is no vault. */
  tree(): Promise<Agent[]>
  page(path: string): Promise<Page>
  /** `mnemo <action> <args>` in `cwd`; the Rust side refuses anything off its allowlist. */
  run(action: string, args: string[], cwd: string): Promise<RunResult>
  /** The health table: rules in `scope` (`''`, `agent:<name>`, `topic:<name>`) matching `filter`, hottest first. */
  rules(scope: string, filter: string): Promise<RuleRow[]>
  /** The rule at `path` and at most `limit` nodes (≤ 30) of its neighbourhood. */
  ego(path: string, limit: number): Promise<VaultGraph>
  /** `mnemo status`, its tiles, and what needs review. Does not run `doctor`. */
  health(): Promise<Health>
  /** `mnemo doctor`, on demand: 4.8s against a 5783-page vault, and only read behind a button. */
  doctor(): Promise<RunResult>
}

export function makeVaultClient(invoke: Invoke): VaultClient {
  return {
    tree: () => invoke<Agent[]>('vault_tree'),
    page: (path) => invoke<Page>('vault_page', { path }),
    run: (action, args, cwd) => invoke<RunResult>('vault_run', { action, args, cwd }),
    rules: (scope, filter) => invoke<RuleRow[]>('vault_rules', { scope, filter }),
    ego: (path, limit) => invoke<VaultGraph>('vault_ego', { path, limit }),
    health: () => invoke<Health>('vault_health'),
    doctor: () => invoke<RunResult>('vault_doctor'),
  }
}
