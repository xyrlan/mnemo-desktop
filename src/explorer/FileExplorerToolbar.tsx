// adapted from stablyai/orca components/right-sidebar/FileExplorerToolbar.tsx
import React from 'react'
import { Ellipsis, ListCollapse, Loader2, RefreshCw } from 'lucide-react'
import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/ui'
import { cn } from '@/ui/cn'

type FileExplorerToolbarProps = {
  repoName: string
  isRefreshing: boolean
  onRefresh: () => void
  canCollapseAll: boolean
  onCollapseAll: () => void
  showGitIgnoredFiles: boolean
  onToggleGitIgnoredFiles: () => void
  showDotfiles: boolean
  onToggleDotfiles: () => void
}

export function FileExplorerToolbar({
  repoName,
  isRefreshing,
  onRefresh,
  canCollapseAll,
  onCollapseAll,
  showGitIgnoredFiles,
  onToggleGitIgnoredFiles,
  showDotfiles,
  onToggleDotfiles,
}: FileExplorerToolbarProps): React.JSX.Element {
  return (
    <div className="flex h-8 min-h-8 items-center gap-2 border-b border-border px-2">
      <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground" title={repoName}>
        {repoName}
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className={cn('text-muted-foreground hover:text-foreground', !canCollapseAll && 'cursor-not-allowed opacity-50')}
            aria-label="Collapse All"
            aria-disabled={!canCollapseAll}
            // Why: native disabled buttons suppress Radix tooltip triggers in Chromium.
            onClick={(event) => {
              if (!canCollapseAll) {
                event.preventDefault()
                return
              }
              onCollapseAll()
            }}
          >
            <ListCollapse className="size-3" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={4}>
          Collapse All
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-foreground"
            aria-label="Refresh Explorer"
            aria-disabled={isRefreshing}
            disabled={isRefreshing}
            onClick={onRefresh}
          >
            {isRefreshing ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={4}>
          Refresh Explorer
        </TooltipContent>
      </Tooltip>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon-xs" className="text-muted-foreground hover:text-foreground" aria-label="More Explorer Actions">
                <Ellipsis className="size-3" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            More Explorer Actions
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="min-w-[12rem]">
          <DropdownMenuCheckboxItem checked={showDotfiles} onCheckedChange={onToggleDotfiles}>
            Show Dotfiles
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem checked={showGitIgnoredFiles} onCheckedChange={onToggleGitIgnoredFiles}>
            Show Git Ignored Files
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
