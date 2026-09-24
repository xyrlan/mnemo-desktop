// adapted from stablyai/orca src/renderer/src/components/right-sidebar/SearchFilters.tsx (MIT, 122b8c25)
import React from 'react'

export type SearchFiltersProps = {
  includePattern: string
  excludePattern: string
  onIncludeChange: (value: string) => void
  onExcludeChange: (value: string) => void
  onKeyDown?: (e: React.KeyboardEvent) => void
}

const INPUT = 'bg-input/50 border border-border rounded-sm px-2 py-1 text-xs outline-none focus:border-ring text-foreground placeholder:text-muted-foreground/50'

export function SearchFilters({ includePattern, excludePattern, onIncludeChange, onExcludeChange, onKeyDown }: SearchFiltersProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-0.5">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Files To Include</span>
        <input
          type="text"
          className={INPUT}
          placeholder="files to include (e.g. *.ts, src/**)"
          value={includePattern}
          onChange={(e) => onIncludeChange(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
        />
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Files To Exclude</span>
        <input
          type="text"
          className={INPUT}
          placeholder="files to exclude (e.g. *.min.js, dist/**)"
          value={excludePattern}
          onChange={(e) => onExcludeChange(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
        />
      </label>
    </div>
  )
}
