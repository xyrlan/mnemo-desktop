// adapted from stablyai/orca src/renderer/src/components/right-sidebar/search-rows.ts (MIT, 122b8c25)
import type { SearchFileResult, SearchMatch, SearchResult } from './client'

export type SearchRow =
  | { type: 'file'; fileResult: SearchFileResult; collapsed: boolean }
  | { type: 'match'; fileResult: SearchFileResult; match: SearchMatch; matchIndex: number }

/** The results as one flat list — a file's header, then its matches unless it is folded — so the
 *  panel can virtualize them: drawing every match of a large result at once froze Orca. */
export function buildSearchRows(results: SearchResult | null, collapsedFiles: ReadonlySet<string>): SearchRow[] {
  if (!results) return []
  const rows: SearchRow[] = []
  for (const fileResult of results.files) {
    const collapsed = collapsedFiles.has(fileResult.filePath)
    rows.push({ type: 'file', fileResult, collapsed })
    if (collapsed) continue
    for (const [matchIndex, match] of fileResult.matches.entries()) rows.push({ type: 'match', fileResult, match, matchIndex })
  }
  return rows
}

/** A match's line split around the match for highlighting. The text before it is cut from the
 *  left to `beforeMax` characters so the match stays in view in a narrow sidebar. */
export function matchParts(match: SearchMatch, beforeMax = 26): { before: string; match: string; after: string } {
  const content = match.lineContent
  const col = (match.displayColumn ?? match.column) - 1
  const len = match.displayMatchLength ?? match.matchLength
  if (col < 0 || col + len > content.length) return { before: content, match: '', after: '' }
  const rawBefore = content.slice(0, col).trimStart()
  const before = rawBefore.length > beforeMax ? `…${rawBefore.slice(rawBefore.length - beforeMax)}` : rawBefore
  return { before, match: content.slice(col, col + len), after: content.slice(col + len) }
}

/** `src/a/b.ts` → `b.ts` and `src/a`; a top-level file has no folder. */
export function splitPath(relativePath: string): { name: string; dir: string } {
  const i = relativePath.lastIndexOf('/')
  return i < 0 ? { name: relativePath, dir: '' } : { name: relativePath.slice(i + 1), dir: relativePath.slice(0, i) }
}
