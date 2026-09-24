// adapted from stablyai/orca src/renderer/src/components/tab-bar/SortableTab.tsx
import { useEffect, useRef, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { FileText, Globe, PanelsTopLeft, SquareTerminal, X } from 'lucide-react'
import { Input, Tooltip, TooltipContent, TooltipTrigger } from '@/ui'
import { cn } from '@/ui/cn'
import type { AgentState } from '../fleet/types'
import { AgentStateDot } from './AgentStateDot'
import type { DropIndicator } from './model'
import { usePointerActivation } from './pointer-activation'

// A definite width pins every tab, so one live title update cannot resize the strip; flex-shrink
// still narrows them to the floor when many are open.
export const TAB_CONTAINER_WIDTH_CLASSES = 'w-[180px] min-w-[72px] min-[1280px]:w-[220px]'
const TAB_LABEL_WIDTH_CLASSES = 'min-w-0 flex-1 truncate'

// A 2px bar on the active tab's bottom edge, bridging it into the panes it owns, over a very
// subtle lift of its background. Neutral, mixed from the foreground, so it reads in both themes.
const ACTIVE_TAB_INDICATOR_CLASSES = 'pointer-events-none absolute inset-x-0 bottom-0 h-[2px] bg-[color-mix(in_srgb,var(--foreground)_60%,var(--card))] z-20'

// The insertion bar is vivid on purpose: the theme's own accent is too quiet for a drop cue.
// Pseudo-elements, so it never shifts the layout.
function dropIndicatorClasses(drop: DropIndicator): string {
  if (drop === 'left') return "before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:bg-blue-500 before:z-10 before:content-['']"
  if (drop === 'right') return "after:absolute after:inset-y-0 after:right-0 after:w-[2px] after:bg-blue-500 after:z-10 after:content-['']"
  return ''
}

function stateClasses(active: boolean): string {
  return active ? 'bg-[color-mix(in_srgb,var(--foreground)_6%,var(--card))] text-foreground' : 'bg-card text-muted-foreground hover:text-foreground'
}

export function FilledBellIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M5.25 9A6.75 6.75 0 0 1 12 2.25 6.75 6.75 0 0 1 18.75 9v3.75c0 .526.214 1.03.594 1.407l.53.532a.75.75 0 0 1-.53 1.28H4.656a.75.75 0 0 1-.53-1.28l.53-.532A1.989 1.989 0 0 0 5.25 12.75V9Zm6.75 12a3 3 0 0 0 2.996-2.825.75.75 0 0 0-.748-.8h-4.5a.75.75 0 0 0-.748.8A3 3 0 0 0 12 21Z"
      />
    </svg>
  )
}

/** What a tab's focused pane is, for its icon when no agent speaks for it. */
export function ViewIcon({ view, className }: { view: string; className?: string }) {
  const Icon = view === 'terminal' ? SquareTerminal : view === 'editor' ? FileText : view === 'browser' ? Globe : PanelsTopLeft
  return <Icon className={cn('size-3 shrink-0', className)} aria-hidden />
}

/** Unread first (a bell), then a live agent's state (working, needs you, done), else the view. */
function LeadingIcon({ state, unread, view, active }: { state: AgentState | null; unread: boolean; view: string; active: boolean }) {
  if (unread)
    return (
      <span data-testid="tab-activity-bell" aria-label="Unread agent activity" className="mr-1 inline-flex shrink-0 items-center gap-1">
        <FilledBellIcon className="size-3 text-amber-500 drop-shadow-sm" />
      </span>
    )
  if (state && state !== 'idle')
    return (
      <span className="mr-1 inline-flex shrink-0 items-center gap-1">
        <AgentStateDot state={state} size="md" />
      </span>
    )
  return (
    <span className={cn('mr-1 inline-flex shrink-0', !active && 'opacity-70')} data-view-icon={view} aria-hidden>
      <ViewIcon view={view} />
    </span>
  )
}

export type SortableTabProps = {
  id: string
  title: string
  view: string
  panes: number
  active: boolean
  state: AgentState | null
  unread: boolean
  hasTabsToRight: boolean
  dropIndicator: DropIndicator
  onActivate(id: string): void
  onClose(id: string): void
  onRename(id: string, name: string | undefined): void
}

export default function SortableTab({ id, title, view, panes, active, state, unread, hasTabsToRight, dropIndicator, onActivate, onClose, onRename }: SortableTabProps) {
  // No transform or transition: tabs stay anchored while one is dragged, only the insertion bar moves.
  const { attributes, listeners, setNodeRef } = useSortable({ id })
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(title)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (editing) input.current?.select()
  }, [editing])
  const commit = () => {
    if (!editing) return
    setEditing(false)
    // Emptied, the tab goes back to the name its focused pane gives it.
    if (value.trim() !== title) onRename(id, value.trim() || undefined)
  }

  // While renaming, typing must not start a drag.
  const dragListeners = editing ? undefined : listeners
  const { onPointerDown } = usePointerActivation({ onActivate: () => onActivate(id), disabled: editing })
  // Live state is newer than a past turn's news: it owns the icon until it ends.
  const showUnread = unread && !editing && state !== 'working' && state !== 'needs-you'

  return (
    <div className={TAB_CONTAINER_WIDTH_CLASSES}>
      <div
        ref={setNodeRef}
        data-testid="sortable-tab"
        data-tab-id={id}
        data-active={active ? 'true' : 'false'}
        data-agent-state={state ?? undefined}
        {...attributes}
        {...dragListeners}
        role="tab"
        aria-selected={active}
        className={cn(
          'group relative flex h-full cursor-pointer items-center px-1.5 text-xs outline-none select-none focus:outline-none focus-visible:outline-none',
          hasTabsToRight && 'border-r',
          'border-border',
          dropIndicatorClasses(dropIndicator),
          stateClasses(active),
        )}
        onDoubleClick={(e) => {
          if (editing) return
          e.stopPropagation()
          setValue(title)
          setEditing(true)
        }}
        onPointerDown={(e) => onPointerDown(e, dragListeners?.onPointerDown as ((e: React.PointerEvent) => void) | undefined)}
        onMouseDown={(e) => {
          // Blocks middle-click autoscroll; the close waits for auxclick.
          if (e.button === 1) e.preventDefault()
        }}
        onAuxClick={(e) => {
          if (editing || e.button !== 1) return
          e.preventDefault()
          e.stopPropagation()
          onClose(id)
        }}
      >
        {active && <span className={ACTIVE_TAB_INDICATOR_CLASSES} aria-hidden />}
        {/* A subtle amber wash flags unread news, over the active lift so the tab still reads selected. */}
        {showUnread && <span aria-hidden data-testid="tab-unread-wash" className="pointer-events-none absolute inset-0 bg-amber-500/10" />}
        <LeadingIcon state={state} unread={showUnread} view={view} active={active} />
        {editing ? (
          <Input
            ref={input}
            data-tab-rename-input="true"
            value={value}
            aria-label={`Rename tab ${title}`}
            onChange={(e) => setValue(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              // An Enter that confirms an IME candidate is not the rename's.
              if (e.nativeEvent.isComposing) return
              if (e.key === 'Enter') {
                e.preventDefault()
                commit()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setEditing(false)
              }
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            className="mr-1 h-5 min-w-[72px] flex-1 px-1 py-0 text-xs"
            spellCheck={false}
          />
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className={cn(TAB_LABEL_WIDTH_CLASSES, 'mr-1')} data-testid="tab-title">
                {title}
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6} className="max-w-80 text-left break-words whitespace-normal">
              {title}
            </TooltipContent>
          </Tooltip>
        )}
        {panes > 1 && !editing && (
          <span className="mr-1 shrink-0 text-[10px] text-muted-foreground tabular-nums" aria-label={`${panes} panes`} data-testid="tab-pane-count">
            {panes}
          </span>
        )}
        {!editing && (
          <button
            type="button"
            className={cn(
              'relative z-10 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm',
              active
                ? 'text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground'
                : 'text-transparent group-hover:text-muted-foreground hover:!bg-muted hover:!text-foreground focus-visible:!bg-muted focus-visible:!text-foreground',
            )}
            aria-label={`Close tab ${title}`}
            title="Close tab (⌘⇧W)"
            data-tab-close-button="true"
            onPointerDown={(e) => e.button === 0 && e.stopPropagation()}
            onMouseDown={(e) => e.button === 0 && e.stopPropagation()}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onClose(id)
            }}
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  )
}
