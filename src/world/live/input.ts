// What the live world is put together from: the answers the app already holds (the mission
// snapshot, the fleet's reading of the hook events, the accounts, mnemo's pulse) and the ones
// this folder asks for itself (the feed, the core wave's insight, trail and vault pulse).

import type { AccountsState, PlanUsage } from '../../accounts/types'
import type { Insights, Trails, VaultPulse } from '../../insight/types'
import type { Snapshot } from '../../mission/types'
import type { AgentView, PrFate, SessionFeed } from '../../nexus/ship-types'
import type { PulseEvent } from '../../pulse/types'

export interface LiveInput {
  /** The mission snapshot, without the time it was taken at (which moves on every poll). */
  snapshot: Pick<Snapshot, 'repos' | 'errors'>
  /** `nexus_feed`: `sessions` by a child's `id` or a parent's `session_id`, `prs` by url. */
  feed: { sessions: Record<string, SessionFeed>; prs: Record<string, PrFate> }
  /** The fleet's answer per session id, hook events fused in: the one "is it busy". */
  agents: Record<string, AgentView>
  /** Every repo the app knows, in the fleet's order: a project with no session is still one. */
  repos: { root: string; name: string }[]
  /** `session_insight`, by the feed's keys. Empty until the core wave lands. */
  insights: Insights
  /** `memory_trail`, by session id. Empty until the core wave lands. */
  trails: Trails
  /** `vault_pulse`; null before it answered. */
  vault: VaultPulse | null
  accounts: {
    state: AccountsState | null
    usage: Record<string, { usage: PlanUsage | null; error: string | null }>
    /** Why the list could not be read, while it cannot. */
    error: string | null
  }
  /** mnemo's events as the app heard them (`mnemo://pulse`), oldest first. */
  pulses: PulseEvent[]
  /** The session ids whose terminal the app runs itself. */
  hosted: string[]
  /** Where each dialog of several questions is, by its call's id (`./asked.ts`). */
  asked: Record<string, number>
  /** What the reader itself could not read, in words. */
  notes: string[]
  now: number
}

export const NO_INPUT: Omit<LiveInput, 'now'> = {
  snapshot: { repos: [], errors: [] },
  feed: { sessions: {}, prs: {} },
  agents: {},
  repos: [],
  insights: {},
  trails: {},
  vault: null,
  accounts: { state: null, usage: {}, error: null },
  pulses: [],
  hosted: [],
  asked: {},
  notes: [],
}
