/** What the fleet consumes from two other wave-A pieces, `worktrees` and `agent-hooks`. One
 *  seam, so the fleet's tests mock a single module. */

export { listWorktrees, type WorktreeInfo } from '../worktrees/client'
export { subscribeAgentEvents, type AgentEvent } from '../agents/events'
