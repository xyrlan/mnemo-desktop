// adapted from stablyai/orca src/renderer/src/components/right-sidebar/SearchResultsPane.tsx (MIT, 122b8c25)
import React from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { SearchFileResult, SearchMatch, SearchResult } from './client'
import type { SearchRow } from './rows'
import { FileResultRow, MatchResultRow } from './SearchResultItems'

const SEARCH_VIRTUAL_OVERSCAN = 12

type SearchResultsPaneProps = {
  results: SearchResult | null
  query: string
  loading: boolean
  error: string | null
  rows: SearchRow[]
  scrollRef: React.RefObject<HTMLDivElement | null>
  onToggleCollapsedFile: (filePath: string) => void
  onMatchClick: (fileResult: SearchFileResult, match: SearchMatch) => void
}

const plural = (n: number, word: string) => `${n} ${word}${n !== 1 ? 's' : ''}`

export function SearchResultsPane({ results, query, loading, error, rows, scrollRef, onToggleCollapsedFile, onMatchClick }: SearchResultsPaneProps): React.JSX.Element {
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    // File rows carry pt-1.5 for the gap between groups, so they are taller than match rows.
    estimateSize: (index) => (rows[index]?.type === 'file' ? 28 : 20),
    // Room after the last row; the first file row's pt-1.5 already spaces the top.
    paddingEnd: 8,
    overscan: SEARCH_VIRTUAL_OVERSCAN,
    getItemKey: (index) => {
      const row = rows[index]
      if (!row) return `missing:${index}`
      if (row.type === 'file') return `file:${row.fileResult.filePath}`
      return `match:${row.fileResult.filePath}:${row.match.line}:${row.match.column}:${row.matchIndex}`
    },
  })

  return (
    <>
      {/* Outside the virtualized list, so it stays at the top while the results scroll. */}
      {results && rows.length > 0 && (
        <div className="px-2 py-1 text-[10px] text-muted-foreground border-b border-border" role="status">
          {plural(results.totalMatches, 'result')} in {plural(results.files.length, 'file')}
          {results.timedOut ? ' (search stopped: it took too long)' : results.truncated ? ' (results truncated)' : ''}
        </div>
      )}

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto scrollbar-sleek">
        {rows.length > 0 && (
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index]
              if (!row) return null
              return (
                <div key={virtualRow.key} className="absolute left-0 top-0 w-full" style={{ transform: `translateY(${virtualRow.start}px)` }}>
                  {row.type === 'file' && (
                    <FileResultRow fileResult={row.fileResult} collapsed={row.collapsed} onToggleCollapse={() => onToggleCollapsedFile(row.fileResult.filePath)} />
                  )}
                  {row.type === 'match' && (
                    <MatchResultRow match={row.match} relativePath={row.fileResult.relativePath} onClick={() => onMatchClick(row.fileResult, row.match)} />
                  )}
                </div>
              )
            })}
          </div>
        )}

        {error && query && !loading && <div className="px-3 py-4 text-center text-xs text-destructive" role="alert">{error}</div>}

        {!error && results && results.files.length === 0 && query && !loading && (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-xs">
            {results.timedOut ? 'No results before the search took too long' : 'No results found'}
          </div>
        )}

        {!query && <div className="flex items-center justify-center h-32 text-muted-foreground text-xs">Type to search in files</div>}
      </div>
    </>
  )
}
