// adapted from stablyai/orca src/renderer/src/components/new-workspace/ProjectCombobox.tsx and ProjectComboboxRow.tsx (MIT, 122b8c25)
import React, { useCallback, useMemo } from 'react'
import { ChevronDown, FolderPlus } from 'lucide-react'
import { Popover, PopoverAnchor, PopoverContent } from '@/ui'
import { cn } from '@/ui/cn'
import { accentHue } from '../home/repo-color'
import { rankProjects, splitPathHead, type ProjectOption } from './match'
import { isWithinComboboxRoot, useTypeAheadCombobox } from './use-type-ahead-combobox'
import { COMBOBOX_FIELD_SHELL, COMBOBOX_POPOVER_SURFACE } from './type-ahead-combobox-styles'

type ProjectComboboxProps = {
  options: readonly ProjectOption[]
  value: string | null
  onValueChange: (projectId: string) => void
  onValueSelected?: (projectId: string) => void
  onAddProject?: () => void
  placeholder?: string
  triggerClassName?: string
  invalid?: boolean
  describedBy?: string
}

const ADD_PROJECT_KEY = 'add-project'
const ROOT_ATTRIBUTE = 'data-project-combobox-root'

/** The repo's square mark, in its hue from its path (Home's `accentHue`): a fixed lightness and
 *  chroma, since the theme's neutral `--accent` would turn every hue grey. */
export function ProjectOptionMark({ option }: { option: ProjectOption }): React.JSX.Element {
  return <span aria-hidden="true" className="size-2.5 shrink-0 rounded-[3px]" style={{ background: `oklch(0.72 0.13 ${accentHue(option.id)})` }} />
}

/** Underlines the matched characters so a fuzzy hit is legible, not mysterious. */
export function MatchedText({ text, hits, className }: { text: string; hits: readonly number[]; className?: string }): React.JSX.Element {
  const marks = new Set(hits)
  if (marks.size === 0) {
    return <span className={cn('min-w-0 truncate', className)}>{text}</span>
  }
  let codeUnit = 0
  return (
    <span className={cn('min-w-0 truncate', className)}>
      {[...text].map((char) => {
        const index = codeUnit
        codeUnit += char.length
        return marks.has(index) ? (
          <mark key={`${index}-${char}`} className="bg-transparent p-0 font-semibold text-foreground underline decoration-ring underline-offset-2">
            {char}
          </mark>
        ) : (
          char
        )
      })}
    </span>
  )
}

/** Detail line that keeps its final two path segments when space runs out. */
export function ProjectOptionDetail({ detail, hits, className }: { detail: string; hits?: readonly number[]; className?: string }): React.JSX.Element {
  const split = splitPathHead(detail)
  if (!split || (hits && hits.length > 0)) {
    return (
      <span className={cn('min-w-0 truncate', className)} title={detail}>
        {hits ? <MatchedText text={detail} hits={hits} /> : detail}
      </span>
    )
  }
  return (
    <span className={cn('flex min-w-0 items-baseline overflow-hidden', className)} title={detail}>
      <span className="min-w-0 shrink-[999] truncate">{split.head}</span>
      <span className="min-w-0 shrink truncate">{split.tail}</span>
    </span>
  )
}

function ProjectOptionRow({
  option,
  nameHits,
  detailHits,
  armed,
  current,
  optionId,
  onArm,
  onCommit,
}: {
  option: ProjectOption
  nameHits: readonly number[]
  detailHits: readonly number[]
  armed: boolean
  current: boolean
  optionId: string | undefined
  onArm: () => void
  onCommit: () => void
}): React.JSX.Element {
  return (
    <div
      role="option"
      id={optionId}
      aria-selected={armed}
      data-armed={armed || undefined}
      data-current={current ? 'true' : undefined}
      onMouseDown={(event) => event.preventDefault()}
      onMouseMove={onArm}
      onClick={onCommit}
      className={cn('flex h-8 cursor-default items-baseline gap-2 rounded-sm px-2 text-sm', armed && 'bg-accent text-accent-foreground', current && !armed && 'bg-accent/60')}
    >
      <span className="flex h-8 shrink-0 items-center">
        <ProjectOptionMark option={option} />
      </span>
      <MatchedText text={option.displayName} hits={nameHits} className={cn('max-w-[50%] shrink', current && 'font-medium')} />
      <ProjectOptionDetail detail={option.detail} hits={detailHits} className="ml-auto min-w-0 flex-1 shrink-[999] justify-end pl-2 text-right text-xs text-muted-foreground" />
    </div>
  )
}

/**
 * Type-ahead project picker: the field *is* the search, so there's no trigger
 * wrapping a second search box. Exactly one row is armed at any time and Enter
 * takes it; hovering arms, so the pointer and the keyboard drive one cursor.
 * "Add project" is pinned to the popover edge so it stays reachable
 * without scrolling, in every state including no-matches and no-projects.
 */
export default function ProjectCombobox({
  options,
  value,
  onValueChange,
  onValueSelected,
  onAddProject,
  placeholder = 'Choose project',
  triggerClassName,
  invalid = false,
  describedBy,
}: ProjectComboboxProps): React.JSX.Element {
  const deriveRowKeys = useCallback(
    (query: string): string[] => [...rankProjects(options, query).map((m) => m.option.id), ...(onAddProject ? [ADD_PROJECT_KEY] : [])],
    [onAddProject, options],
  )
  const { query, setQuery, open, setOpen, close, handleOpenChange, armedKey, arm, moveArm, inputRef, listId, setListNode } = useTypeAheadCombobox(deriveRowKeys)

  const matches = useMemo(() => rankProjects(options, query), [options, query])
  const selected = options.find((option) => option.id === value) ?? null
  // A committed pick shows as the field's own content; typing replaces it.
  const committed = selected !== null && query.length === 0

  const commit = useCallback(
    (key: string | null): void => {
      if (key === null) return
      close()
      if (key === ADD_PROJECT_KEY) {
        onAddProject?.()
        return
      }
      onValueChange(key)
      onValueSelected?.(key)
    },
    [close, onAddProject, onValueChange, onValueSelected],
  )

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>): void => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setOpen(true)
        moveArm(event.key === 'ArrowDown' ? 1 : -1)
        return
      }
      if (event.key === 'Enter' && open) {
        event.preventDefault()
        event.stopPropagation()
        commit(armedKey)
        return
      }
      // Escape always restores the committed display, and only bubbles (to close the dialog)
      // when there's nothing to undo.
      if (event.key === 'Escape' && (open || query.length > 0)) {
        event.preventDefault()
        event.stopPropagation()
        close()
        return
      }
      // Backspace on a committed pick unsticks it back into editable text.
      if (event.key === 'Backspace' && committed && selected) {
        event.preventDefault()
        setQuery(selected.displayName)
        setOpen(true)
      }
    },
    [armedKey, close, commit, committed, moveArm, open, query, selected, setOpen, setQuery],
  )

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverAnchor asChild>
        <div
          data-project-combobox-root="true"
          onClick={() => {
            inputRef.current?.focus()
            setOpen(true)
          }}
          className={cn(COMBOBOX_FIELD_SHELL, invalid && 'border-destructive ring-destructive/20 dark:ring-destructive/40', triggerClassName)}
        >
          <span className="flex w-4 shrink-0 items-center justify-center">{committed && selected ? <ProjectOptionMark option={selected} /> : null}</span>
          <div className="relative min-w-0 flex-1 overflow-hidden">
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              data-project-combobox-root="true"
              aria-label="Project"
              aria-expanded={open}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={open && armedKey ? `${listId}-armed` : undefined}
              aria-invalid={invalid ? true : undefined}
              aria-describedby={describedBy}
              value={query}
              placeholder={committed ? '' : placeholder}
              onChange={(event) => {
                setQuery(event.target.value)
                setOpen(true)
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={handleKeyDown}
              className={cn('w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground', committed && 'text-transparent caret-foreground')}
            />
            {/* Painted over the input so a long name and its path can shrink at different rates
                instead of truncating as one flat string. */}
            {committed && selected ? (
              <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center text-sm">
                <div className="flex min-w-0 flex-1 items-baseline gap-2">
                  <span className="min-w-0 max-w-[50%] shrink truncate">{selected.displayName}</span>
                  <ProjectOptionDetail detail={selected.detail} className="min-w-0 flex-1 shrink-[999] justify-end text-right text-xs text-muted-foreground" />
                </div>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            tabIndex={-1}
            aria-label="Browse projects"
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.stopPropagation()
              inputRef.current?.focus()
              setOpen(!open)
            }}
            className="-mr-1 flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
          </button>
        </div>
      </PopoverAnchor>
      {/* Closing must remove the selector before a nested dialog takes focus. */}
      {open ? (
        <PopoverContent
          align="start"
          sideOffset={4}
          // Opaque and unfaded: this lands on the composer dialog, and a translucent fade shows
          // the Name field through the list mid-animation.
          className={cn('flex w-[var(--radix-popover-trigger-width)] min-w-[17rem] flex-col p-0', COMBOBOX_POPOVER_SURFACE)}
          // Focus stays in the field — it's the search box.
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          // The field lives in the anchor, not the content: keep the layer open for
          // interactions within this control; genuine outside events still close it.
          onFocusOutside={(event) => {
            if (isWithinComboboxRoot(event.target, ROOT_ATTRIBUTE)) event.preventDefault()
          }}
          onInteractOutside={(event) => {
            if (isWithinComboboxRoot(event.target, ROOT_ATTRIBUTE)) event.preventDefault()
          }}
        >
          <div id={listId} role="listbox" aria-label="Projects" className="flex min-h-0 flex-col">
            <div ref={setListNode} role="presentation" className="max-h-72 min-h-0 flex-1 overflow-y-auto p-1 scrollbar-sleek">
              {matches.length === 0 ? (
                <p className="flex h-8 items-center justify-center px-2 text-sm text-muted-foreground">
                  {options.length === 0 ? 'No projects yet.' : 'No projects match your search.'}
                </p>
              ) : null}
              {matches.map((m) => (
                <ProjectOptionRow
                  key={m.option.id}
                  option={m.option}
                  nameHits={m.nameHits}
                  detailHits={m.detailHits}
                  armed={armedKey === m.option.id}
                  current={m.option.id === value}
                  optionId={armedKey === m.option.id ? `${listId}-armed` : undefined}
                  onArm={() => arm(m.option.id)}
                  onCommit={() => commit(m.option.id)}
                />
              ))}
            </div>
            {onAddProject ? (
              <div
                role="option"
                id={armedKey === ADD_PROJECT_KEY ? `${listId}-armed` : undefined}
                aria-selected={armedKey === ADD_PROJECT_KEY}
                data-armed={armedKey === ADD_PROJECT_KEY || undefined}
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => arm(ADD_PROJECT_KEY)}
                onClick={() => commit(ADD_PROJECT_KEY)}
                className={cn('flex h-9 shrink-0 cursor-default items-center gap-2 border-t border-border px-2 text-sm', armedKey === ADD_PROJECT_KEY && 'bg-accent text-accent-foreground')}
              >
                <FolderPlus className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">Add project</span>
              </div>
            ) : null}
          </div>
        </PopoverContent>
      ) : null}
    </Popover>
  )
}
