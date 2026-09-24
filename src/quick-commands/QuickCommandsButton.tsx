import type React from 'react'
import { Pencil, Plus, SquareTerminal, Trash2, Zap } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, Tooltip, TooltipContent, TooltipTrigger } from '@/ui'
import type { QuickCommand } from './commands'

type Props = {
  /** The shown worktree's repo, or null: nothing to save commands for, and the button is off. */
  repoName: string | null
  commands: readonly QuickCommand[]
  open: boolean
  onOpenChange(open: boolean): void
  onRun(cmd: QuickCommand): void
  onAdd(): void
  onEdit(index: number): void
  onRemove(index: number): void
}

/** A row's pencil and bin: acting on the command, not running it. */
function RowAction({ label, onAct, children }: { label: string; onAct(): void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="flex size-5 items-center justify-center rounded text-muted-foreground opacity-0 group-hover/qc:opacity-100 group-focus/qc:opacity-100 hover:bg-black/8 hover:text-foreground dark:hover:bg-white/14"
      // Why: the row is a menu item; a click here must not bubble into it and run the command.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onAct()
      }}
    >
      {children}
    </button>
  )
}

/** Orca's quick-commands button, at the titlebar's right end: the shown repo's saved commands;
 *  picking one runs it in the focused terminal. */
export function QuickCommandsButton({ repoName, commands, open, onOpenChange, onRun, onAdd, onEdit, onRemove }: Props): React.JSX.Element {
  const disabled = repoName === null
  return (
    // Why: not modal, so the add/edit dialog it opens takes the pointer back when the menu closes.
    <DropdownMenu open={open && !disabled} onOpenChange={onOpenChange} modal={false}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild disabled={disabled}>
            <button type="button" className="sidebar-toggle mr-1 disabled:cursor-default disabled:opacity-40" aria-label="Quick commands" data-quick-commands="">
              <Zap size={15} />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {disabled ? 'Quick commands — open a worktree first' : 'Quick commands'}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="truncate text-[11px] text-muted-foreground">{repoName}</DropdownMenuLabel>
        {commands.length === 0 && <div className="px-2 py-1.5 text-[12px] text-muted-foreground">No quick commands saved for this repo yet.</div>}
        {commands.map((cmd, i) => (
          <DropdownMenuItem key={i} className="group/qc items-start" onSelect={() => onRun(cmd)}>
            <SquareTerminal className="mt-[2px]" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">{cmd.label}</span>
              <span className="truncate font-mono text-[11px] text-muted-foreground">{cmd.command}</span>
            </span>
            <span className="flex shrink-0 items-center gap-0.5">
              <RowAction label={`Edit ${cmd.label}`} onAct={() => onEdit(i)}>
                <Pencil className="size-3" />
              </RowAction>
              <RowAction label={`Remove ${cmd.label}`} onAct={() => onRemove(i)}>
                <Trash2 className="size-3" />
              </RowAction>
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onAdd}>
          <Plus />
          Add command…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
