import { invoke } from '@tauri-apps/api/core'
import type { MemoryFeed } from './types'

/** The Memory panel's data for the worktree at `cwd` and, when given, the session in front of
 *  you (`memory_feed.rs`). Rejects, with the core's reason as the Error's message, when there is
 *  no vault or no project. */
export async function getMemoryFeed(cwd: string, sessionId?: string): Promise<MemoryFeed> {
  let f: MemoryFeed
  try {
    f = await invoke<MemoryFeed>('memory_feed', { cwd, sessionId: sessionId ?? null })
  } catch (e) {
    // The core refuses with a string; the panel shows an Error's message.
    throw e instanceof Error ? e : new Error(String(e))
  }
  // A backend of another shape (an older build, a mock) is a failed read, not a crash.
  if (!f || typeof f.project !== 'string' || !Array.isArray(f.fired) || !Array.isArray(f.learned) || !Array.isArray(f.inbox)) {
    throw new Error('memory_feed answered something this panel cannot read')
  }
  return f
}
