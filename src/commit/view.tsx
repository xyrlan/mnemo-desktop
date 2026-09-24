/** The commit composer (Orca's, with AI text). It has no pane view: it lives in `view.tsx`
 *  because App imports every `src/*\/view.tsx`, and that import is where it registers
 *  `commit.open` and mounts the composer in the shell's overlay. */
import type React from 'react'
import { toast } from '@/ui'
import { register } from '../actions/registry'
import { mountInSlot } from '../shell/slots'
import { store as layout } from '../layout/app-store'
import { openUrl } from '../github/actions'
import { tauriCommit } from './client'
import CommitComposer from './CommitDialog'
import { openCommit } from './open'

const modLabel = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform) ? '⌘' : 'Ctrl'

function Commit(): React.JSX.Element {
  return <CommitComposer client={tauriCommit} onOpenUrl={openUrl} modLabel={modLabel} />
}

/** `commit.open` acts on the worktree on screen. */
export function openCommitForActive(active: string | null = layout.getState().activeWorktree): void {
  if (active) openCommit(active)
  else toast.error('Open a worktree to commit its changes.')
}

register({ id: 'commit.open', title: 'Commit…', run: () => openCommitForActive() })

mountInSlot('overlay', Commit)
