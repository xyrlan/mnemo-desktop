// adapted from stablyai/orca components/sidebar/repo-header-action-button-class.ts and
// components/sidebar/worktree-list/rows/SectionHeader.tsx [343-400] (MIT, 122b8c25): the
// hover-revealed "…" on a repo header. Orca's menus themselves are not vendored; these carry
// mnemo's own items in `@/ui`'s menu primitives.
import React from 'react'
import { BrushCleaning, Ellipsis, ExternalLink, FolderMinus, Trash2 } from 'lucide-react'
import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui'
import type { RepoNode, WorktreeNode } from '../fleet/types'
import { forgetRepo, openCleanup, requestRemove } from './archive'
import { activateWorktree } from './actions'

const REPO_HEADER_ACTION_REVEAL_CLASS =
  'min-w-0 max-w-0 -ml-1.5 overflow-hidden opacity-0 focus:ml-0 focus:max-w-5 focus:opacity-100 group-hover:ml-0 group-hover:max-w-5 group-hover:opacity-100'

const REPO_HEADER_ACTION_BUTTON_CLASS = `size-5 shrink-0 ${REPO_HEADER_ACTION_REVEAL_CLASS} rounded-md text-muted-foreground transition-[margin,max-width,opacity,background-color,color] hover:bg-accent/70 hover:text-foreground data-[state=open]:ml-0 data-[state=open]:max-w-5 data-[state=open]:opacity-100`

// Why: the header is one big toggle; a press on its menu must not fold the repo too.
const keepFromHeader = {
  onClick: (e: React.SyntheticEvent) => e.stopPropagation(),
  onKeyDown: (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') e.stopPropagation()
  },
}

/** A repo's "…": clean up its stale worktrees (the view lists every repo's), or forget it. */
export function RepoHeaderMenu({ repo }: { repo: RepoNode }): React.JSX.Element {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={`${repo.name} actions`} className={REPO_HEADER_ACTION_BUTTON_CLASS} {...keepFromHeader}>
          <Ellipsis className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="bottom" sideOffset={4} className="min-w-44" {...keepFromHeader}>
        <DropdownMenuItem onSelect={openCleanup}>
          <BrushCleaning />
          Clean up workspaces…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void forgetRepo(repo)}>
          <FolderMinus />
          Forget project
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The same items on a right click of the repo header. */
export function RepoHeaderContextMenu({ repo, children }: { repo: RepoNode; children: React.ReactElement }): React.JSX.Element {
  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-44">
        <ContextMenuItem onSelect={openCleanup}>
          <BrushCleaning />
          Clean up workspaces…
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => void forgetRepo(repo)}>
          <FolderMinus />
          Forget project
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** A card's right-click menu: show it, remove it (asked first when it has changes or agents at
 *  work), or clean up every stale one. The main checkout is not removed. */
export function WorktreeContextMenu({ worktree, children }: { worktree: WorktreeNode; children: React.ReactElement }): React.JSX.Element {
  const main = worktree.kind === 'main'
  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-48">
        <ContextMenuItem onSelect={() => activateWorktree(worktree.path)}>
          <ExternalLink />
          Open
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={openCleanup}>
          <BrushCleaning />
          Clean up workspaces…
        </ContextMenuItem>
        <ContextMenuItem variant="destructive" disabled={main} onSelect={() => void requestRemove(worktree)}>
          <Trash2 />
          {main ? 'Main checkout: not removable' : 'Remove workspace'}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
