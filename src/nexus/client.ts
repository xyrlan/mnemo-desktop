import { invoke as tauriInvoke } from '@tauri-apps/api/core'

export type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>

export interface NexusClient {
  /** One row to `~/.mnemo-desktop/usage.jsonl`: `startNexusUsage`'s, which mnemo's measure tool reads. */
  logUsage(row: Record<string, unknown>): Promise<void>
}

export function makeNexusClient(invoke: Invoke): NexusClient {
  return {
    logUsage: (row) => invoke('usage_log', { row }),
  }
}

export const tauriNexus = makeNexusClient(tauriInvoke)
