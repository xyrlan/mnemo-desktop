import type { RuleSet } from './types'

export type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>

export interface MarketplaceClient {
  /** Every source's sets; clones a source the first time, fetches nothing else. */
  list(): Promise<RuleSet[]>
  /** Fetches one source (every source when `url` is omitted), then lists. */
  refresh(url?: string): Promise<RuleSet[]>
  addSource(url: string): Promise<void>
  removeSource(url: string): Promise<void>
  /** `mnemo import <path>` in `cwd`; resolves with its output, rejects with it on failure. */
  importSet(path: string, cwd: string): Promise<string>
}

export function makeMarketplaceClient(invoke: Invoke): MarketplaceClient {
  return {
    list: () => invoke<RuleSet[]>('marketplace_list'),
    refresh: (url) => invoke<RuleSet[]>('marketplace_refresh', { url: url ?? null }),
    addSource: (url) => invoke<void>('marketplace_add_source', { url }),
    removeSource: (url) => invoke<void>('marketplace_remove_source', { url }),
    importSet: (path, cwd) => invoke<string>('marketplace_import', { path, cwd }),
  }
}
