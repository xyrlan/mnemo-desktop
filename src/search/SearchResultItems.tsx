// adapted from stablyai/orca src/renderer/src/components/right-sidebar/SearchResultItems.tsx (MIT, 122b8c25)
import React, { useMemo } from 'react'
import { ChevronRight, Copy, File, FileCode, FileImage, FileJson, FileText } from 'lucide-react'
import { Button, ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui'
import { cn } from '@/ui/cn'
import type { SearchFileResult, SearchMatch } from './client'
import { matchParts, splitPath } from './rows'

const copy = (text: string) => void navigator.clipboard?.writeText(text).catch(() => {})

const CODE = /\.(tsx?|jsx?|mjs|cjs|rs|py|go|rb|java|kt|swift|c|h|cc|cpp|hpp|cs|php|sh|zsh|css|scss|html|vue|svelte|sql|lua|zig)$/i
/** Orca picks an icon per file type; these few cover what a worktree mostly holds. */
function fileTypeIcon(path: string): typeof File {
  if (/\.jsonc?$/i.test(path)) return FileJson
  if (/\.(png|jpe?g|gif|svg|webp|ico)$/i.test(path)) return FileImage
  if (/\.(md|mdx|txt|rst)$/i.test(path)) return FileText
  if (CODE.test(path)) return FileCode
  return File
}

// ─── Toggle Button ────────────────────────────────────────
export function ToggleButton({
  active,
  onClick,
  title,
  children,
  ariaExpanded,
}: {
  active: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
  ariaExpanded?: boolean
}): React.JSX.Element {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className={cn(
        'h-auto w-auto rounded-sm p-0.5 flex-shrink-0',
        active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted',
      )}
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      aria-expanded={ariaExpanded}
    >
      {children}
    </Button>
  )
}

// ─── File Result ──────────────────────────────────────────
export function FileResultRow({
  fileResult,
  onToggleCollapse,
  collapsed,
}: {
  fileResult: SearchFileResult
  onToggleCollapse: () => void
  collapsed: boolean
}): React.JSX.Element {
  const { name: fileName, dir: dirPath } = splitPath(fileResult.relativePath)
  const FileIcon = fileTypeIcon(fileResult.relativePath)

  return (
    <div className="pt-1.5">
      <TooltipProvider delayDuration={400}>
        <Tooltip>
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-auto w-full justify-start gap-1 rounded-none px-2 py-0.5 text-left group"
                  onClick={onToggleCollapse}
                  aria-expanded={!collapsed}
                >
                  <ChevronRight className={cn('size-3 flex-shrink-0 text-muted-foreground transition-transform', !collapsed && 'rotate-90')} />
                  <FileIcon className="size-3.5 flex-shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1 text-xs">
                    <span className="min-w-0 block truncate">
                      <span className="text-foreground">{fileName}</span>
                      {dirPath && <span className="ml-1.5 text-[11px] text-muted-foreground">{dirPath}</span>}
                    </span>
                  </div>
                  <span className="text-[10px] text-muted-foreground flex-shrink-0 bg-muted/80 rounded-full px-1.5">{fileResult.matches.length}</span>
                </Button>
              </TooltipTrigger>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onClick={() => copy(fileResult.relativePath)}>
                <Copy className="size-3.5" />
                Copy Path
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
          {/* The row truncates long folders to stay compact; the tooltip keeps the whole path. */}
          <TooltipContent side="top" sideOffset={6}>
            {fileResult.relativePath}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  )
}

// ─── Match Item ───────────────────────────────────────────
export function MatchResultRow({ match, relativePath, onClick }: { match: SearchMatch; relativePath: string; onClick: () => void }): React.JSX.Element {
  const parts = useMemo(() => matchParts(match), [match])

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="min-h-[18px] h-auto w-full justify-start gap-1 rounded-none py-px pr-2 pl-7 text-left"
          onMouseDown={(event) => {
            // Opening a result moves focus into the editor; a focused sidebar button would take
            // it back after the click.
            if (event.button === 0) event.preventDefault()
          }}
          onClick={onClick}
        >
          <span className="text-[10px] text-muted-foreground flex-shrink-0 tabular-nums mt-px">{match.line}</span>
          <span className="text-xs flex min-w-0 items-baseline whitespace-pre">
            <span className="text-muted-foreground flex-shrink-0">{parts.before}</span>
            {parts.match && <mark className="bg-amber-500/30 text-foreground rounded-sm flex-shrink-0">{parts.match}</mark>}
            <span className="text-muted-foreground min-w-0 truncate">{parts.after}</span>
          </span>
        </Button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => copy(`${relativePath}#L${match.line}`)}>
          <Copy className="size-3.5" />
          Copy Line Path
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
