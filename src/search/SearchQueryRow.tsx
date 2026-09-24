// adapted from stablyai/orca src/renderer/src/components/right-sidebar/SearchQueryRow.tsx (MIT, 122b8c25)
import React from 'react'
import { Search as SearchIcon, CaseSensitive, WholeWord, Regex, X, Loader2 } from 'lucide-react'
import { Button } from '@/ui'
import { ToggleButton } from './SearchResultItems'

export type SearchQueryRowProps = {
  inputRef: React.Ref<HTMLInputElement>
  query: string
  loading: boolean
  caseSensitive: boolean
  wholeWord: boolean
  useRegex: boolean
  onQueryChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onKeyDown: (e: React.KeyboardEvent) => void
  onClearSearch: () => void
  onToggleCaseSensitive: () => void
  onToggleWholeWord: () => void
  onToggleRegex: () => void
}

export function SearchQueryRow({
  inputRef,
  query,
  loading,
  caseSensitive,
  wholeWord,
  useRegex,
  onQueryChange,
  onKeyDown,
  onClearSearch,
  onToggleCaseSensitive,
  onToggleWholeWord,
  onToggleRegex,
}: SearchQueryRowProps): React.JSX.Element {
  return (
    <div className="flex h-7 items-center gap-1 rounded-sm border border-border bg-input/50 px-1.5 focus-within:border-ring">
      <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <input
        ref={inputRef}
        type="text"
        className="min-w-0 flex-1 bg-transparent py-1 text-xs text-foreground outline-none placeholder:text-muted-foreground/50"
        aria-label="Search files"
        placeholder="Search"
        value={query}
        onChange={onQueryChange}
        onKeyDown={onKeyDown}
        spellCheck={false}
      />
      {loading ? <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" aria-label="Searching" /> : null}
      {query ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="h-auto w-auto rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
          aria-label="Clear search"
          onClick={onClearSearch}
        >
          <X className="size-3" />
        </Button>
      ) : null}
      <ToggleButton active={caseSensitive} onClick={onToggleCaseSensitive} title="Match Case">
        <CaseSensitive className="size-3.5" />
      </ToggleButton>
      <ToggleButton active={wholeWord} onClick={onToggleWholeWord} title="Match Whole Word">
        <WholeWord className="size-3.5" />
      </ToggleButton>
      <ToggleButton active={useRegex} onClick={onToggleRegex} title="Use Regular Expression">
        <Regex className="size-3.5" />
      </ToggleButton>
    </div>
  )
}
