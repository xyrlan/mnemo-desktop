// What the tests of the live world are built from: snapshot rows, feeds and insights made in
// the test, and sources a test holds in its hands. `./backwards.ts` builds rows with these too.
// Every name and path here is invented.

import type { Insight, InsightAsk, Insights, Trails, VaultPulse } from '../../insight/types'
import type { ChildSession, ParentSession, Pr, RepoGroup, Snapshot } from '../../mission/types'
import type { Feed, FeedAsk, PrFate, SessionFeed } from '../../nexus/ship-types'
import type { RepoNode } from '../../fleet/types'
import type { PulseEvent } from '../../pulse/types'
import type { LiveSources, Watch } from './engine'
import { NO_INPUT, type LiveInput } from './input'

/** The moment the tests call now. */
export const NOW = Date.parse('2026-11-09T21:30:00Z')
export const MIN = 60_000
export const iso = (t: number) => new Date(t).toISOString()

export const PARENT = 'aaaaaaaa-0000-4000-8000-000000000001'
export const CHILD = 'cccccccc-0000-4000-8000-000000000001'
export const ROOT = '/Users/you/code/atlas'

export function parent(over: Partial<ParentSession> = {}): ParentSession {
  return { session_id: PARENT, pid: 100, name: 'atlas', status: 'idle', cwd: ROOT, waiting_for: null, account: 'default', ...over }
}

/** A live child that acted a minute ago. `session_id` follows `id` unless given. */
export function child(over: Partial<ChildSession> = {}): ChildSession {
  const session_id = over.session_id === undefined ? (over.id ? `${over.id}-0000-4000-8000-000000000001` : CHILD) : over.session_id
  return {
    id: (session_id ?? CHILD).slice(0, 8),
    name: null,
    state: 'working',
    tempo: 'active',
    needs: null,
    detail: '',
    suggested_reply: null,
    cwd: `${ROOT}-wt-412`,
    tokens: 0,
    live: true,
    updated_at: iso(NOW - MIN),
    intent: 'Fix the order history query',
    branch: null,
    timeline_len: 0,
    parent_session: PARENT,
    waiting_for: null,
    model: null,
    effort: null,
    pr: null,
    account: 'default',
    account_env: null,
    notice: null,
    ...over,
    session_id,
  }
}

export function pr(over: Partial<Pr> = {}): Pr {
  return { number: 77, url: 'https://github.com/acme/atlas/pull/77', state: 'OPEN', head: 'fix/issue-412', ci: 'pass', draft: false, failing: [], ...over }
}

export function repo(over: Partial<RepoGroup> = {}): RepoGroup {
  return { root: ROOT, name: 'atlas', parents: [parent()], missions: [], children: [], ...over }
}

export function feedOf(over: Partial<SessionFeed> = {}): SessionFeed {
  return { activity: null, said: null, context: null, model: null, topic: null, title: null, contract: null, ask: null, ...over }
}

export const fate = (over: Partial<PrFate> = {}): PrFate => ({ state: 'OPEN', mergedAt: null, closedAt: null, checks: [], ...over })

const ZERO = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, thinking: 0 }

export function insight(over: Partial<Insight> = {}): Insight {
  return {
    title: null,
    model: null,
    effort: null,
    permissionMode: null,
    accountUuid: null,
    branch: null,
    startedAt: null,
    lastAt: null,
    recap: null,
    lastPrompt: null,
    said: null,
    pendingAsk: null,
    turns: 0,
    turnMs: 0,
    tokens: { main: ZERO, sidechain: ZERO, subagents: [], byModel: {}, own: ZERO },
    cost: null,
    context: { tokens: null, window: 200_000, percent: null, series: [], compactions: [] },
    activity: [],
    activityTotal: 0,
    activityCounts: {},
    timeline: [],
    web: { searches: [], fetches: [], pages: [], shots: [], artifacts: [] },
    files: { edited: [], read: [] },
    prs: [],
    memory: { instructions: [], touches: [], skills: [] },
    ...over,
  }
}

/** An input at `NOW` with the repos given (one repo with one idle parent when none is). */
export function input(over: Partial<LiveInput> & { repos_?: RepoGroup[] } = {}): LiveInput {
  const { repos_, ...rest } = over
  return { ...NO_INPUT, snapshot: { repos: repos_ ?? [repo()], errors: [] }, now: NOW, ...rest }
}

export const pulse = (over: Partial<PulseEvent> = {}): PulseEvent => ({ at: NOW - MIN, kind: 'reflex', project: 'atlas', agent: 'atlas', slugs: ['prefer-cursor-pagination'], ...over })

/* ------------------------------------------------------------------ the engine's sources -- */

export function held<T>(value: T): Watch<T> & { set(next: T): void } {
  const subs = new Set<() => void>()
  return {
    get: () => value,
    subscribe(cb) {
      subs.add(cb)
      return () => void subs.delete(cb)
    },
    set(next) {
      value = next
      for (const cb of [...subs]) cb()
    },
  }
}

export const snapshotOf = (repos: RepoGroup[], at = iso(NOW)): Snapshot => ({ repos, errors: [], at })

/** A fleet that says of each session what the hook events said. */
export const fleetOf = (agents: Record<string, { state: 'working' | 'needs-you' | 'done' | 'idle'; waitingFor?: 'permission' | 'question' | null }>): RepoNode[] => [
  {
    root: ROOT,
    name: 'atlas',
    worktrees: [{ path: ROOT, name: 'atlas', branch: null, kind: 'main', pr: null, unread: false, agents: Object.entries(agents).map(([sessionId, a]) => ({ sessionId, paneId: null, state: a.state, waitingFor: a.waitingFor ?? null, title: '', since: 0 })) }],
  },
]

/** Sources a test holds in its hands: what each store says, what each command answers, the
 *  clock, and the two polls, which run only when the test says so. */
export function fakeSources(snapshot: Snapshot = { repos: [], errors: [], at: '' }) {
  const state = {
    now: NOW,
    feed: { sessions: {}, prs: {}, rate: null, at: NOW } as Feed,
    insights: {} as Insights,
    trails: {} as Trails,
    vault: { rules: null, prompts: 0, outcomes: {}, learned: [], recent: [] } as VaultPulse,
    feedFails: null as string | null,
    asked: { feed: [] as FeedAsk[][], insight: [] as InsightAsk[][], trails: [] as string[][] },
    ticks: [] as { tick: () => unknown; ms: number; stopped: boolean }[],
    subscribed: 0,
  }
  const counted = <T,>(w: Watch<T> & { set(next: T): void }) => ({
    ...w,
    subscribe(cb: () => void) {
      state.subscribed++
      const off = w.subscribe(cb)
      return () => {
        state.subscribed--
        off()
      }
    },
  })
  const mission = counted(held(snapshot))
  const missionError = counted(held<string | null>(null))
  const fleet = counted(held<RepoNode[]>([]))
  const accounts = counted(held<LiveInput['accounts']>({ state: null, usage: {}, error: null }))
  const pulses = counted(held<PulseEvent[]>([]))
  const hosted = counted(held<string[]>([]))
  // Each answer is a fresh copy, as an answer from the core is, of what was asked about only.
  const fresh = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
  const only = <T,>(all: Record<string, T>, keys: string[]): Record<string, T> => fresh(Object.fromEntries(Object.entries(all).filter(([key]) => keys.includes(key))))
  const sources: LiveSources = {
    mission,
    missionError,
    fleet,
    accounts,
    pulses,
    hosted,
    async feed(asks) {
      state.asked.feed.push(asks)
      if (state.feedFails) throw new Error(state.feedFails)
      return { ...fresh(state.feed), sessions: only(state.feed.sessions, asks.map((a) => a.key)) }
    },
    async insight(asks) {
      state.asked.insight.push(asks)
      return only(state.insights, asks.map((a) => a.key))
    },
    async trails(ids) {
      state.asked.trails.push(ids)
      return only(state.trails, ids)
    },
    vault: async () => fresh(state.vault),
    now: () => state.now,
    every(tick, ms) {
      const entry = { tick, ms, stopped: false }
      state.ticks.push(entry)
      return () => {
        entry.stopped = true
      }
    },
  }
  /** Lets every promise and microtask under way finish. */
  const settle = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve()
  }
  /** Runs the poll of `ms` once, as its timer would, and waits for what it started. */
  const run = async (ms: number) => {
    for (const t of state.ticks) if (t.ms === ms && !t.stopped) await t.tick()
    await settle()
  }
  return { sources, state, mission, missionError, fleet, accounts, pulses, hosted, settle, run }
}
