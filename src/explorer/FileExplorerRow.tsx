// adapted from stablyai/orca components/right-sidebar/FileExplorerRow.tsx and file-explorer-row-context-menu.tsx
import React from 'react'
import {
  ChevronRight,
  CircleSlash,
  Copy,
  File,
  FileCode,
  FileImage,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  ListCollapse,
  Loader2,
  SquareSplitHorizontal,
  SquareTerminal,
} from 'lucide-react'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/ui'
import { cn } from '@/ui/cn'
import { STATUS_LABELS } from './git'
import type { GitFileStatus, TreeNode } from './types'

const CODE = /\.(tsx?|jsx?|mjs|cjs|rs|py|go|rb|java|kt|swift|c|h|cc|cpp|hpp|cs|php|sh|zsh|bash|css|scss|html|vue|svelte|sql|lua|toml|ya?ml)$/i
const TEXT = /\.(md|mdx|txt|rst|log)$|^(readme|license|changelog)/i
const IMAGE = /\.(png|jpe?g|gif|svg|webp|ico|icns|bmp|avif)$/i

/** Orca picks an icon per file type; these are the families worth telling apart at a glance. */
export function fileTypeIcon(name: string): React.ComponentType<{ className?: string }> {
  if (/\.json5?$|\.jsonc$/i.test(name)) return FileJson
  if (IMAGE.test(name)) return FileImage
  if (CODE.test(name)) return FileCode
  if (TEXT.test(name)) return FileText
  return File
}

function stopRightButtonMenuSelection(event: React.PointerEvent): void {
  if (event.button !== 2) return
  // Why: Radix opens context menus under the pointer; on some macOS paths the
  // right-button release lands on the first item and selects it.
  event.preventDefault()
  event.stopPropagation()
}

export type FileExplorerRowProps = {
  node: TreeNode
  tabIndex: number
  isExpanded: boolean
  isLoading: boolean
  isSelected: boolean
  nodeStatus: GitFileStatus | null
  statusColor: string | null
  isIgnored: boolean
  canCollapseFolderSubtree: boolean
  onClick: (e: React.MouseEvent) => void
  onDoubleClick: () => void
  onOpenToSide: () => void
  onCopyPath: (kind: 'absolute' | 'relative') => void
  onOpenInTerminal: () => void
  onCollapseFolderSubtree: () => void
}

export function FileExplorerRow({
  node,
  isExpanded,
  isLoading,
  isSelected,
  nodeStatus,
  statusColor,
  isIgnored,
  canCollapseFolderSubtree,
  onClick,
  onDoubleClick,
  onOpenToSide,
  onCopyPath,
  onOpenInTerminal,
  onCollapseFolderSubtree,
  tabIndex,
}: FileExplorerRowProps): React.JSX.Element {
  const FileIcon = fileTypeIcon(node.name)
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          role="treeitem"
          tabIndex={tabIndex}
          data-file-explorer-row=""
          data-path={node.path}
          data-selected={isSelected ? 'true' : undefined}
          aria-level={node.depth + 1}
          aria-selected={isSelected}
          aria-expanded={node.isDirectory ? isExpanded : undefined}
          className={cn(
            'flex w-full items-center gap-1 rounded-sm px-2 py-1 text-left text-xs transition-colors outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring',
            !isSelected && 'hover:bg-accent hover:text-foreground',
            isSelected && 'text-accent-foreground',
          )}
          style={{ paddingLeft: `${node.depth * 16 + 8}px` }}
          onClick={onClick}
          onDoubleClick={onDoubleClick}
        >
          {node.isDirectory ? (
            <>
              <ChevronRight className={cn('size-3 shrink-0 text-muted-foreground transition-transform', isExpanded && 'rotate-90')} />
              {isLoading ? (
                <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
              ) : isExpanded ? (
                <FolderOpen className="size-3 shrink-0 text-muted-foreground" />
              ) : (
                <Folder className="size-3 shrink-0 text-muted-foreground" />
              )}
            </>
          ) : (
            <>
              <span className="size-3 shrink-0" />
              <FileIcon className="size-3 shrink-0 text-muted-foreground" />
            </>
          )}
          <span
            className={cn(
              'truncate',
              isSelected && !nodeStatus && !isIgnored && 'text-accent-foreground',
              // Why: italic glyphs overhang their advance width; truncate's
              // overflow:hidden clips it, shaving the last char (".md" → ".ma").
              // pr-0.5 reserves room for the slant so the final letter survives.
              isIgnored && 'italic pr-0.5',
            )}
            style={nodeStatus ? { color: statusColor ?? undefined } : isIgnored ? { color: 'var(--git-decoration-ignored)' } : undefined}
          >
            {node.name}
          </span>
          {nodeStatus ? (
            <span className="ml-auto mr-2 shrink-0 text-[10px] font-semibold tracking-wide" style={{ color: statusColor ?? undefined }}>
              {/* A folder carries its files' colour and a dot, not a letter of its own. */}
              {node.isDirectory ? '•' : STATUS_LABELS[nodeStatus]}
            </span>
          ) : isIgnored ? (
            <CircleSlash aria-label="Ignored by .gitignore" className="ml-auto mr-2 size-3 shrink-0" style={{ color: 'var(--git-decoration-ignored)' }} />
          ) : null}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent
        className="w-64 bg-[rgba(255,255,255,0.82)] dark:bg-[rgba(0,0,0,0.72)]"
        onPointerUpCapture={stopRightButtonMenuSelection}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {!node.isDirectory && (
          <ContextMenuItem onSelect={onOpenToSide}>
            <SquareSplitHorizontal />
            Open to the Side
          </ContextMenuItem>
        )}
        {node.isDirectory && (
          <ContextMenuItem onSelect={onOpenInTerminal}>
            <SquareTerminal />
            Open in Terminal
          </ContextMenuItem>
        )}
        {canCollapseFolderSubtree && node.isDirectory && isExpanded && (
          <ContextMenuItem onSelect={onCollapseFolderSubtree}>
            <ListCollapse />
            Collapse Folder
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => onCopyPath('absolute')}>
          <Copy />
          Copy Path
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onCopyPath('relative')}>
          <Copy />
          Copy Relative Path
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
