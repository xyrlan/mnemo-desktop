import { invoke } from '@tauri-apps/api/core'

/** Mirrors `search::SearchOpts` in src-tauri/src/search.rs. */
export type SearchOpts = {
  caseSensitive: boolean
  wholeWord: boolean
  useRegex: boolean
  /** Globs, comma separated: `*.ts, src/**`. */
  include: string
  exclude: string
  maxResults?: number
}

/** One match: `line` and `column` 1-based, `column` and `matchLength` in UTF-16 units. */
export type SearchMatch = {
  line: number
  column: number
  matchLength: number
  lineContent: string
  /** Where the match sits in `lineContent` when a long line was cut around it. */
  displayColumn?: number
  displayMatchLength?: number
}

export type SearchFileResult = { filePath: string; relativePath: string; matches: SearchMatch[] }

export type SearchResult = {
  files: SearchFileResult[]
  totalMatches: number
  /** More matches exist than came back. */
  truncated: boolean
  /** The time limit, not the result limit, stopped the search. */
  timedOut: boolean
}

/** Searches the files under `root`; bounded in results and time on the Rust side. */
export const searchWorktree = (root: string, query: string, opts: SearchOpts): Promise<SearchResult> =>
  invoke<SearchResult>('search_worktree', { root, query, opts })
