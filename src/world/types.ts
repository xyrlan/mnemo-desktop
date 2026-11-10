// The one model every view reads (docs/superpowers/specs/2026-11-10-recreation-design.md,
// "The model: World"). It is the prototypes' capture (docs/superpowers/prototypes/redesign/DATA.md)
// as TypeScript, with every time in epoch ms. `src/world/live/` builds it from the core;
// `src/world/sample.ts` is the synthetic one. A field the source did not have is `null` or an
// empty list, never missing.

import type { Bucket, ClaudeMemory, Context, Cost, Files, TokenRow, Tokens, ToolCall, Trail, VaultPulse, Web, Words } from '../insight/types'

export type { Bucket, ClaudeMemory, Context, Cost, Files, TokenRow, Tokens, ToolCall, Trail, VaultPulse, Web, Words }

/** What a session is to the maintainer right now.
 *  need: it waits for him (a question, a permission, a block).
 *  working: it is acting on its own.
 *  ready: it is over and a pull request it opened is still open.
 *  stalled: it stopped without finishing.
 *  idle: it is live and its turn is over, with nothing asked. His move.
 *  ended: no process, nothing waiting. */
export type SessionState = 'need' | 'working' | 'ready' | 'stalled' | 'idle' | 'ended'

/** Most urgent first: the order of attention every view sorts by. */
export const STATE_ORDER: readonly SessionState[] = ['need', 'stalled', 'ready', 'working', 'idle', 'ended']

export interface PullRequest {
  number: number
  url: string
  repo: string
  /** open | merged | closed, or null before GitHub answered. */
  state: 'open' | 'merged' | 'closed' | null
  draft: boolean | null
  title: string | null
  ci: 'green' | 'red' | 'running' | null
  mergeable: string | null
}

export interface Session {
  /** The Claude Code session id; `short` is its first 8 characters. */
  id: string
  short: string
  /** parent: a session the maintainer talks to. child: one mnemo dispatched. */
  role: 'parent' | 'child'
  parent: string | null
  children: string[]
  agentKind: 'interactive' | 'background' | null
  /** claude | grok: which CLI runs it. */
  agent: string
  /** A process is running it now. */
  live: boolean
  /** The app runs this session's terminal itself (so the stage can show it live). */
  hosted: boolean
  state: SessionState
  /** A `need` nobody answered for so long that mnemo gave up on it. */
  abandoned: boolean
  /** The repo's name; a worktree's session belongs to its repo. */
  project: string | null
  /** The repo's root, for actions that need a place. */
  root: string | null
  cwd: string | null
  branch: string | null
  /** Claude Code's own title for the session, a person's name for it winning. */
  title: string
  /** An `Account.id`. */
  account: string
  model: string | null
  effort: string | null
  advisor: string | null
  permissionMode: string | null
  startedAt: number | null
  lastAt: number | null

  /** Claude Code's own "while you were away" summary, the newest one. */
  recap: Words | null
  /** The last prompt a person typed. */
  lastPrompt: string | null
  /** The last thing the session said. */
  said: Words | null
  /** Children only: the dispatch prompt's opening, mnemo's status line, what it waits for. */
  intent: string | null
  detail: string | null
  needs: string | null
  /** A child's contract, when it is a piece of one. */
  contract: { feature: string; piece: string } | null
  issue: number | null
  turns: number
  turnMs: number

  tokens: Tokens
  /** `own`: this session with its sub-agents. `tree`: `own` plus every child's `own`. */
  totals: { own: TokenRow; tree: TokenRow }
  cost: Cost | null
  context: Context

  /** The newest tool calls, oldest first, capped. */
  activity: ToolCall[]
  activityTotal: number
  activityCounts: Record<string, number>
  timeline: Bucket[]
  web: Web
  files: Files
  prs: PullRequest[]

  /** Claude Code's side of memory (`claude`) and mnemo's (`trail`). */
  memory: { claude: ClaudeMemory; trail: Trail }
}

export type PendingKind = 'question' | 'permission' | 'blocked' | 'merge' | 'stalled'

/** One way to answer a waiting item. `key` is the digit that picks it, from 1. */
export interface Choice {
  key: number
  label: string
  hint: string | null
  /** What picking it does, for the view to mark: `good` (allow, merge, resume), `bad` (deny,
   *  stop, send back), or `neutral` (a question's option). */
  tone: 'good' | 'bad' | 'neutral'
}

/** Something that waits for the maintainer. Its choices are the same list in every view. */
export interface Pending {
  /** Stable while the item waits: what `Actions.answer` takes. */
  id: string
  session: string
  kind: PendingKind
  text: string
  /** A permission's tool and command, a merge's PR: the line under the text. */
  detail: string | null
  choices: Choice[]
  /** Whether "in your words" makes sense for it. */
  reply: boolean
  suggestedReply: string | null
  pr: PullRequest | null
  since: number | null
}

export interface PlanLimit {
  kind: string
  group: string
  model: string | null
  percent: number
  severity: string
  resetsAt: number | null
  active: boolean
}

export interface Account {
  id: string
  label: string
  kind: string
  active: boolean
  plan: string | null
  limits: PlanLimit[]
  /** Why the plan's numbers are old, when they are. */
  stale: string | null
}

export interface Project {
  name: string
  root: string | null
  sessions: string[]
}

/** A thing that happened in the fleet, for Score's lines and the memory in flight. */
export interface WorldEvent {
  at: number
  kind: 'dispatched' | 'finished' | 'pr-opened' | 'pr-merged' | 'asked' | 'answered' | 'rule-injected' | 'rule-read' | 'learned'
  session: string | null
  text: string
}

export interface World {
  /** sample: the synthetic world. live: this machine. */
  source: 'sample' | 'live'
  /** When it was put together: "now" for every age a view shows. */
  at: number
  /** Newest activity first. */
  sessions: Session[]
  /** Oldest first. */
  pending: Pending[]
  accounts: Account[]
  /** Most sessions first. */
  projects: Project[]
  vault: VaultPulse
  /** Oldest first, capped. */
  events: WorldEvent[]
  /** What could not be read, in words, for the top bar to say. */
  errors: string[]
}
