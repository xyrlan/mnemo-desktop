// adapted from stablyai/orca src/renderer/src/components/tab-bar/tab-bar-surface.tsx and
// tab-bar-static-create-menu.tsx (MIT, 122b8c25): the "+" and its static create items
import { Globe, Plus, SquareTerminal } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuShortcut, DropdownMenuTrigger } from '@/ui'
import { run } from '../actions/registry'

export type NewTabKind = 'terminal' | 'browser'

/** What the "+" offers, in order, with the action each runs and Orca's chords. */
export const NEW_TAB_ITEMS: readonly { kind: NewTabKind; label: string; action: string; shortcut: string }[] = [
  { kind: 'terminal', label: 'New Terminal', action: 'tab.new', shortcut: '⌘T' },
  { kind: 'browser', label: 'New Browser Tab', action: 'tab.new-browser', shortcut: '⌘⇧B' },
]

/** Opens a tab of `kind` through its action, so the menu, the chord and ⌘K do the same thing. */
export function newTab(kind: NewTabKind, runAction: (id: string) => void = run) {
  const item = NEW_TAB_ITEMS.find((i) => i.kind === kind)
  if (item) runAction(item.action)
}

const ICONS: Record<NewTabKind, typeof Globe> = { terminal: SquareTerminal, browser: Globe }

/** The strip's "+": a menu of the tabs it can open. */
export default function NewTabMenu({ onNew = newTab }: { onNew?: (kind: NewTabKind) => void }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="my-auto ml-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground data-[state=open]:bg-accent/50 data-[state=open]:text-foreground"
          title="New tab"
          aria-label="New tab"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="w-60 max-w-[calc(100vw-1rem)] rounded-[11px] border-border/80 p-1 shadow-[0_16px_36px_rgba(0,0,0,0.24)]"
        // Radix would hand focus back to the "+", taking it from the tab just opened.
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {NEW_TAB_ITEMS.map(({ kind, label, shortcut }) => {
          const Icon = ICONS[kind]
          return (
            <DropdownMenuItem key={kind} data-new-tab={kind} onSelect={() => onNew(kind)} className="gap-2 rounded-[7px] px-2 py-1.5 text-[12px] leading-5 font-medium">
              <Icon className="size-4 text-muted-foreground" />
              {label}
              <DropdownMenuShortcut>{shortcut}</DropdownMenuShortcut>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
