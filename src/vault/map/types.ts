/** Mirrors `src-tauri/src/vaultmap.rs`. */

export type MapNode = {
  /** The page path: the node id. */
  path: string
  slug: string
  name: string
  confidence: string | null
  /** Fires with a 30-day half-life; 0 for a ghost. */
  heat: number
  type: string
  /** `shared`, or the repo agent. */
  agent: string
  /** All-time fires: a rule that never fired is grey. */
  fires: number
  /** An `_inbox` proposal, drawn hollow beside the page it would rewrite. */
  ghost: boolean
}

/** `link`: a wikilink either way. `topic`: shared rare topics. `rewrite`: ghost → the page. */
export type MapEdgeKind = 'link' | 'topic' | 'rewrite'

export type MapEdge = { source: string; target: string; kind: MapEdgeKind }

/** `vault_map(scope)`. */
export type VaultMap = { nodes: MapNode[]; edges: MapEdge[]; error: string | null }

/** Page path → `[x, y]` in graph coordinates. */
export type Positions = Record<string, [number, number]>

/** `mnemo://vault-born`: a page appeared under `shared/` or an agent's `memory/`. */
export type Born = { path: string; slug: string }

/** `mnemo://vault-changed`: pages rewritten or removed, proposals staged or dropped. */
export type Changed = { paths: string[] }
