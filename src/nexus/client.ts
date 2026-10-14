import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import type { ArchiveCounts } from './types'

export type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>

export interface NexusClient {
  /** Live pages per project and the universal count (`nexus_archives` in `src-tauri/src/nexus.rs`). */
  archives(): Promise<ArchiveCounts>
  /** One row to `~/.mnemo-desktop/usage.jsonl`. */
  logUsage(row: Record<string, unknown>): Promise<void>
}

export function makeNexusClient(invoke: Invoke): NexusClient {
  return {
    archives: () => invoke<ArchiveCounts>('nexus_archives'),
    logUsage: (row) => invoke('usage_log', { row }),
  }
}

export const tauriNexus = makeNexusClient(tauriInvoke)
