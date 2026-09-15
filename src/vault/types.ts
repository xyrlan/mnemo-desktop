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

export type GraphNode = {
  /** The page path, or `topic:<name>` for a topic hub. */
  id: string
  kind: 'rule' | 'topic'
  label: string
  /** Empty for a topic hub. */
  slug: string
  type: string
  confidence: string | null
  topics: string[]
  /** Reflex emissions plus MCP reads; for a hub, how many of the graph's rules carry the topic. */
  fires: number
  /** ms since the epoch */
  last_fired: number | null
}

export type GraphEdge = { id: string; source: string; target: string; kind: 'link' | 'topic' }

export type VaultGraph = {
  scope: string
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** Rule pages in scope before the node cap. */
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
