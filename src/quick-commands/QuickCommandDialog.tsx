// adapted from stablyai/orca src/renderer/src/components/terminal-quick-commands/
// TerminalQuickCommandDialog.tsx, TerminalQuickCommandLabelField.tsx,
// TerminalQuickCommandContentSection.tsx and TerminalQuickCommandDialogFooter.tsx (MIT, 122b8c25).
// Kept: the label field, the framed command editor, the footer and ⌘↵ to save. Not ported: the
// agent-prompt action, the scope section and the "append Enter" switch — a command here belongs
// to the repo it was saved in and always runs.
import { useState } from 'react'
import type React from 'react'
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input } from '@/ui'
import { cleaned, type QuickCommand } from './commands'

type Props = {
  open: boolean
  mode: 'add' | 'edit'
  /** The command being edited, or the blank one being added. */
  command: QuickCommand
  /** The repo's name, for the description. */
  repoName: string
  onOpenChange(open: boolean): void
  onSave(command: QuickCommand): void
  /** Edit mode: take the command out of the repo's list. */
  onRemove?(): void
}

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)
const SUBMIT_LABEL = isMac ? '⌘↵' : 'Ctrl+↵'
const isSubmit = (e: React.KeyboardEvent) => e.key === 'Enter' && (isMac ? e.metaKey : e.ctrlKey)

const LABEL = 'flex items-center gap-2 text-sm leading-none font-medium select-none'

export function QuickCommandDialog({ open, mode, command, repoName, onOpenChange, onSave, onRemove }: Props): React.JSX.Element {
  const [draft, setDraft] = useState<QuickCommand>(command)
  const [synced, setSynced] = useState<{ open: boolean; command: QuickCommand }>({ open, command })
  // Orca's reset: a dialog that opens, or opens on another command, starts from that command.
  if (synced.open !== open || synced.command !== command) {
    setSynced({ open, command })
    if (open) setDraft({ ...command })
  }

  const canSave = cleaned(draft) !== null
  const save = () => {
    const next = cleaned(draft)
    if (!next) return
    onSave(next)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-ui="" className="flex max-h-[min(90vh,40rem)] w-full max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl" showCloseButton={false}>
        <DialogHeader className="px-6 pt-6 pb-0">
          <DialogTitle className="text-sm">{mode === 'edit' ? 'Edit Quick Command' : 'Add Quick Command'}</DialogTitle>
          <DialogDescription className="text-xs">Saved for {repoName}; it appears in the titlebar menu for one-click run in the focused terminal.</DialogDescription>
        </DialogHeader>

        <div
          className="scrollbar-sleek flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5"
          onKeyDown={(e) => {
            if (isSubmit(e) && canSave) {
              e.preventDefault()
              save()
            }
          }}
        >
          <div className="space-y-2">
            <label className={LABEL} htmlFor="quick-command-label">
              Label
            </label>
            <Input id="quick-command-label" value={draft.label} onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))} placeholder="Start dev server" autoFocus />
          </div>

          {/* Why: the textarea drops its own ring, so the frame carries the focus state. */}
          <div className="overflow-hidden rounded-md border border-border bg-[var(--editor-surface)] transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
            <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/70 px-3 py-2">
              <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Command</span>
            </div>
            <textarea
              value={draft.command}
              aria-label="Command"
              onChange={(e) => setDraft((d) => ({ ...d, command: e.target.value }))}
              placeholder="pnpm dev"
              spellCheck={false}
              rows={6}
              className="min-h-[9rem] w-full resize-y border-0 bg-transparent px-3.5 py-3 font-mono text-[13px] outline-none focus-visible:ring-0"
            />
            <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/50 px-3 py-2">
              <span className="text-[11px] text-muted-foreground">Typed into the focused terminal, then Enter.</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">Drag corner to resize</span>
            </div>
          </div>
        </div>

        <DialogFooter className="border-t border-border px-6 py-4 sm:justify-end">
          {mode === 'edit' && onRemove && (
            <Button
              type="button"
              variant="ghost"
              className="mr-auto text-destructive hover:text-destructive"
              onClick={() => {
                onRemove()
                onOpenChange(false)
              }}
            >
              Remove
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={!canSave} title={`Save (${SUBMIT_LABEL})`}>
            Save
            <span className="ml-1 text-[10px] opacity-60">{SUBMIT_LABEL}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
