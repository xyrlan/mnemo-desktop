// What the core's `session_insight`, `insight_shot`, `memory_trail` and `vault_pulse` commands
// answer (src-tauri/src/insight.rs, src-tauri/src/memory_trail.rs), as the front reads them.
// Times are epoch ms. Keep in step with the Rust types: they are the contract.

export interface InsightAsk {
  /** What the answer is keyed by: a child's id, a parent's session id. */
  key: string
  sessionId: string
  cwd: string
  account: string
}

/** `thinking` is the part of `output` spent thinking. */
export interface TokenRow {
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
  thinking: number
}

export interface SubagentTokens {
  id: string
  description: string
  agentType: string | null
  model: string | null
  calls: number
  tokens: TokenRow
}

/** `own` = `main` + `sidechain` + every sub-agent. */
export interface Tokens {
  main: TokenRow
  sidechain: TokenRow
  subagents: SubagentTokens[]
  byModel: Record<string, TokenRow>
  own: TokenRow
}

export interface Cost {
  usd: number
  apiMs: number
  toolMs: number
  linesAdded: number
  linesRemoved: number
}

export interface Compaction {
  at: number
  pre: number
  post: number
  trigger: string | null
}

export interface Context {
  tokens: number | null
  window: number
  percent: number | null
  /** `[at, tokens]` per call, thinned. */
  series: [number, number][]
  compactions: Compaction[]
}

export type ToolKind =
  | 'read' | 'search-code' | 'edit' | 'write' | 'shell' | 'web-search' | 'web-fetch' | 'browser'
  | 'artifact' | 'agent' | 'message' | 'skill' | 'ask' | 'memory' | 'mcp' | 'meta' | 'other'

export interface ToolCall {
  at: number
  tool: string
  kind: ToolKind
  target: string
  running: boolean
  ok: boolean | null
  ms: number | null
}

export interface Bucket {
  t: number
  kinds: Partial<Record<ToolKind, number>>
}

export interface Web {
  searches: { at: number; query: string; results: { title: string; url: string }[] }[]
  fetches: { at: number; url: string; code: number | null; bytes: number | null; ms: number | null; summary: string }[]
  pages: { at: number; url: string; title: string }[]
  /** `id` is what `insight_shot` takes. */
  shots: { id: string; at: number; url: string | null; title: string | null; mediaType: string }[]
  artifacts: { at: number; url: string; title: string }[]
}

export interface Files {
  edited: { path: string; edits: number; lastAt: number }[]
  read: { path: string; count: number }[]
}

export interface ClaudeMemory {
  /** Files Claude Code loaded at the start: `kind` is `Project`, `User`, `AutoMem`, … */
  instructions: { path: string; kind: string; at: number; bytes: number }[]
  touches: { at: number; path: string; file: 'claude-memory' | 'claude-md'; op: 'read' | 'write' | 'edit'; via: string }[]
  skills: { at: number; name: string }[]
}

export interface Words {
  at: number
  text: string
}

export interface PendingAsk {
  id: string
  at: number
  question: string
  options: { label: string; description: string }[]
}

export interface Insight {
  title: string | null
  model: string | null
  effort: string | null
  permissionMode: string | null
  accountUuid: string | null
  branch: string | null
  startedAt: number | null
  lastAt: number | null
  recap: Words | null
  lastPrompt: string | null
  said: Words | null
  pendingAsk: PendingAsk | null
  turns: number
  turnMs: number
  tokens: Tokens
  cost: Cost | null
  context: Context
  /** The newest calls, oldest first, capped. */
  activity: ToolCall[]
  activityTotal: number
  activityCounts: Partial<Record<ToolKind, number>>
  timeline: Bucket[]
  web: Web
  files: Files
  prs: { number: number; url: string; repo: string }[]
  memory: ClaudeMemory
}

/** `session_insight` answers this, keyed by `InsightAsk.key`. */
export type Insights = Record<string, Insight>

export interface Candidate {
  slug: string
  name: string | null
  score: number
  judge: number | null
}

export interface Trail {
  prompts: number
  injected: { at: number; slug: string; name: string | null; score: number | null; judge: number | null }[]
  considered: { at: number; reason: string; candidates: Candidate[] }[]
  read: { at: number; tool: string; slug: string | null; topic: string | null; query: string | null; hits: string[]; ms: number | null }[]
  briefings: { at: number; project: string; date: string | null; path: string; source: string | null; entries: number | null }[]
  frictions: { at: number; quote: string; rule: string; origin: string | null }[]
}

/** `memory_trail` answers this, keyed by session id. */
export type Trails = Record<string, Trail>

export interface VaultPulse {
  rules: number | null
  prompts: number
  outcomes: Record<string, number>
  learned: { at: number; slug: string; name: string; projects: string[] }[]
  recent: { at: number; kind: 'injected' | 'read' | 'learned'; slug: string; sessionId: string | null; project: string | null }[]
}
