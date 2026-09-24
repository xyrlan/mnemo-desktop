import { invoke } from '@tauri-apps/api/core'

/** What the fleet consumes from two wave-A pieces written beside it, `worktrees`
 *  (`src/worktrees/client.ts`) and `agent-hooks` (`src/agents/events.ts`), which did not exist
 *  when this was written. The types are the contract's, copied. Once both pieces are on
 *  `main`, this file becomes re-exports of theirs:
 *
 *    export { listWorktrees, type WorktreeInfo } from '../worktrees/client'
 *    export { subscribeAgentEvents, type AgentEvent } from '../agents/events'
 */

export type WorktreeInfo = {
  path: string
  branch: string | null
  head: string
  isMain: boolean
  dispatched: boolean
  dirty: boolean
  setupJob: string | null
}

export type AgentEvent = {
  sessionId: string
  cwd: string
  kind: 'start' | 'prompt' | 'stop' | 'notification' | 'end'
  message?: string
  at: number
}

/** The contract's `worktree_list` command, as `listWorktrees` calls it. */
export const listWorktrees = (repo: string): Promise<WorktreeInfo[]> => invoke('worktree_list', { repo })

/** No events until `agent-hooks` lands: the event name it emits is its own. The fleet then runs
 *  on polling alone, which is what it falls back to anyway. */
export const subscribeAgentEvents = (_cb: (e: AgentEvent) => void): (() => void) => () => {}
