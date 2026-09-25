import { FolderX } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/ui'
import type { Tab } from '../layout/store'
import { ViewIcon } from './SortableTab'

export type StrayTab = { id: string; title: string; view: string; folder: string | undefined }

/** The tabs of no open worktree — shells that outlived a restart in a folder no worktree holds —
 *  kept out of every strip and reached from here: choosing one brings it into the worktree shown.
 *  Nothing when there is none. */
export default function Elsewhere({ tabs, onBring }: { tabs: readonly StrayTab[]; onBring(id: string): void }) {
  if (tabs.length === 0) return null
  const what = `${tabs.length} tab${tabs.length === 1 ? '' : 's'} outside any workspace`
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="tabs-elsewhere"
          className="my-auto ml-1 flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground data-[state=open]:bg-accent/50 data-[state=open]:text-foreground"
          title={what}
          aria-label={what}
        >
          <FolderX className="size-3.5" />
          <span className="tabular-nums">{tabs.length}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Outside any workspace — open one here</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {tabs.map((t) => (
          <DropdownMenuItem key={t.id} data-stray-tab={t.id} onSelect={() => onBring(t.id)} title={t.folder}>
            <ViewIcon view={t.view} className="size-3.5 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{t.title}</span>
            {t.folder && <span className="max-w-[45%] shrink-0 truncate font-mono text-[10px] text-muted-foreground">{t.folder}</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** A tab of no worktree as the menu lists it. */
export function strayTab(tab: Tab, title: string, pane: { view: string; cwd?: string } | undefined): StrayTab {
  return { id: tab.id, title, view: pane?.view ?? 'terminal', folder: pane?.cwd }
}
