// adapted from stablyai/orca src/renderer/src/components/right-sidebar/SearchQueryRow.tsx, SearchFilters.tsx and SearchResultsPane.tsx (MIT, 122b8c25)
import React, { useEffect, useMemo, useRef } from 'react'
import { useStore } from 'zustand'
import { Ellipsis, FolderSearch } from 'lucide-react'
import type { SearchFileResult, SearchMatch } from './client'
import { buildSearchRows } from './rows'
import { SearchFilters } from './SearchFilters'
import { SearchQueryRow } from './SearchQueryRow'
import { ToggleButton } from './SearchResultItems'
import { SearchResultsPane } from './SearchResultsPane'
import type { SearchActions, SearchState, SearchStore } from './store'

export type SearchPanelProps = {
  store: SearchStore
  /** The worktree to search; null before one is on screen. */
  root: string | null
  onOpenMatch(file: SearchFileResult, match: SearchMatch): void
}

/** The Search panel: a query with case, whole-word and regex switches, include and exclude globs
 *  behind the ··· button, and the matches grouped by file. Typing searches after a pause, Enter
 *  at once, Escape clears; a match opens its file at that line. */
export function SearchPanel({ store, root, onOpenMatch }: SearchPanelProps): React.JSX.Element {
  const use = <T,>(sel: (s: SearchState & SearchActions) => T): T => useStore(store, sel)
  const query = use((s) => s.query)
  const caseSensitive = use((s) => s.caseSensitive)
  const wholeWord = use((s) => s.wholeWord)
  const useRegex = use((s) => s.useRegex)
  const include = use((s) => s.include)
  const exclude = use((s) => s.exclude)
  const showFilters = use((s) => s.showFilters)
  const results = use((s) => s.results)
  const loading = use((s) => s.loading)
  const error = use((s) => s.error)
  const collapsed = use((s) => s.collapsed)
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => store.getState().setRoot(root), [store, root])
  // The panel opens to type into, as VS Code's and Orca's do.
  useEffect(() => inputRef.current?.focus(), [])

  const rows = useMemo(() => buildSearchRows(results, collapsed), [results, collapsed])
  const st = store.getState()

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void st.run()
    } else if (e.key === 'Escape' && query) {
      e.preventDefault()
      st.clear()
    }
  }

  if (!root) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-xs text-muted-foreground" data-ui>
        <FolderSearch className="size-5" />
        Open a worktree to search its files.
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-ui>
      <div className="flex flex-col gap-1.5 border-b border-border px-2 py-2">
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <SearchQueryRow
              inputRef={inputRef}
              query={query}
              loading={loading}
              caseSensitive={caseSensitive}
              wholeWord={wholeWord}
              useRegex={useRegex}
              onQueryChange={(e) => st.setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              onClearSearch={() => {
                st.clear()
                inputRef.current?.focus()
              }}
              onToggleCaseSensitive={() => st.toggle('caseSensitive')}
              onToggleWholeWord={() => st.toggle('wholeWord')}
              onToggleRegex={() => st.toggle('useRegex')}
            />
          </div>
          <ToggleButton active={showFilters || !!include || !!exclude} onClick={st.toggleFilters} title="Toggle Search Details" ariaExpanded={showFilters}>
            <Ellipsis className="size-3.5" />
          </ToggleButton>
        </div>
        {showFilters && (
          <SearchFilters includePattern={include} excludePattern={exclude} onIncludeChange={st.setInclude} onExcludeChange={st.setExclude} onKeyDown={onKeyDown} />
        )}
      </div>
      <SearchResultsPane
        results={results}
        query={query}
        loading={loading}
        error={error}
        rows={rows}
        scrollRef={scrollRef}
        onToggleCollapsedFile={st.toggleCollapsed}
        onMatchClick={onOpenMatch}
      />
    </div>
  )
}
