import { invoke } from '@tauri-apps/api/core'
import type { ChildMemory } from './types'

/** Kept separate from `src/mission/client.ts` (another piece's file): one call, one seam. */
export const memoryClient = {
  childMemory: (sessionId: string): Promise<ChildMemory> => invoke('child_memory', { sessionId }),
}
