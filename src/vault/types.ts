/** Mirrors `src-tauri/src/vault.rs`. */

export type PageInfo = {
  path: string
  slug: string
  name: string
  description: string
  type: string
  confidence: string | null
  topics: string[]
  /** ms since the epoch */
  modified: number | null
  body: string
}

export type Group = { type: string; pages: PageInfo[] }

export type AgentKind = 'shared' | 'repo' | 'other'

export type Agent = { name: string; kind: AgentKind; dir: string; groups: Group[] }

export type Page = PageInfo & {
  runtime: string | null
  frontmatter: { key: string; value: string }[]
  error: string | null
}

export type RunResult = { stdout: string; stderr: string; code: number | null }

/** A badge of the health table. `stale` is added on this side, from `mnemo stale --json`. */
export type Badge = 'never' | 'stale' | 'review' | 'inbox'

export type RuleRow = {
  path: string
  slug: string
  name: string
  description: string
  type: string
  /** `shared`, or the repo agent. */
  agent: string
  confidence: string | null
  topics: string[]
  fires: number
  /** ms since the epoch */
  last_fired: number | null
  /** Fires with a 30-day half-life; rows come hottest first. */
  heat: number
  badges: Badge[]
  /** Why `review`. */
  reasons: string[]
}

export type GraphNode = {
  /** The page path. */
  id: string
  label: string
  slug: string
  type: string
  confidence: string | null
  topics: string[]
  fires: number
  /** ms since the epoch */
  last_fired: number | null
}

/** `link`: a `[[wikilink]]` from source to target. `topic`: centre → a neighbour sharing `label`'s topics. */
export type GraphEdge = { id: string; source: string; target: string; kind: 'link' | 'topic'; label: string }

/** `vault_ego`: one rule and its neighbourhood. */
export type VaultGraph = {
  /** The centre's path, as asked. */
  center: string
  /** The centre first. */
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** Neighbours found before the node limit. */
  total: number
  error: string | null
}

export type Tile = { key: string; label: string; value: string; detail: string; tone: 'ok' | 'bad' | 'muted' }

export type Review = { path: string; slug: string; name: string; reason: string }

export type Health = {
  root: string | null
  status: RunResult
  doctor: RunResult
  tiles: Tile[]
  label_only: Review[]
  dormant: Review[]
  pages: number
  never_fired: number
  inbox: number
  error: string | null
}
