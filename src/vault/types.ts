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
