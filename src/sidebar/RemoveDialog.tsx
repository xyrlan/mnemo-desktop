// adapted from stablyai/orca components/workspace-cleanup/workspace-cleanup-confirm-remove.tsx
// [30-120] (MIT, 122b8c25): the same warning header and footer, for one worktree.
import React from 'react'
import { AlertTriangle, Trash2 } from 'lucide-react'
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui'
import { answerRemove, useArchive } from './archive'

/** What would be lost, one sentence each. */
function risks(dirty: boolean, live: number): string[] {
  const out: string[] = []
  if (dirty) out.push('Its uncommitted changes and untracked files are deleted with it.')
  if (live > 0) out.push(live === 1 ? 'An agent is at work in it; its terminal closes.' : `${live} agents are at work in it; their terminals close.`)
  return out
}

/** A card's "Remove workspace" when the worktree has changes or agents at work: asked first. */
export function RemoveDialog(): React.JSX.Element {
  const ask = useArchive((a) => a.ask)
  return (
    <Dialog open={ask !== null} onOpenChange={(open) => !open && void answerRemove(false)}>
      <DialogContent showCloseButton={false} className="max-w-[440px] gap-0 p-0" data-remove-dialog="">
        {ask && (
          <>
            <DialogHeader className="px-5 pt-5 pb-3">
              <div className="flex min-w-0 items-start gap-3">
                <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-destructive/25 bg-destructive/10 text-destructive">
                  <AlertTriangle className="size-4" />
                </div>
                <div className="min-w-0">
                  <DialogTitle className="text-base">Remove {ask.name}?</DialogTitle>
                  <DialogDescription className="mt-1.5 text-xs leading-5">
                    {risks(ask.dirty, ask.live).join(' ')} {ask.branch ? `Branch ${ask.branch} is kept.` : ''}
                  </DialogDescription>
                </div>
              </div>
              <div className="mt-2 min-w-0 truncate pl-11 font-mono text-[11px] text-muted-foreground/80">{ask.path}</div>
            </DialogHeader>
            <DialogFooter className="border-t border-border px-5 py-3">
              <Button variant="outline" onClick={() => void answerRemove(false)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={() => void answerRemove(true)}>
                <Trash2 className="size-4" />
                Remove
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
