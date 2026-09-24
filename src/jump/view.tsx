/** The worktree jump palette. It has no pane view: it lives in `view.tsx` because App imports
 *  every `src/*\/view.tsx`, and that import is where it registers `worktree.jump` (the keymap
 *  binds Mod+J to it) and mounts itself in the shell's overlay slot. */
import type React from 'react'
import { register } from '../actions/registry'
import { useFleet } from '../fleet/store'
import { store as layout, useApp } from '../layout/app-store'
import { mountInSlot } from '../shell/slots'
import { JumpPalette } from './JumpPalette'
import { jumpStore, useJump } from './store'

function ConnectedJumpPalette(): React.JSX.Element | null {
  const open = useJump((s) => s.open)
  const setOpen = useJump((s) => s.setOpen)
  const repos = useFleet((f) => f.repos)
  const activeWorktree = useApp((s) => s.activeWorktree)
  return <JumpPalette open={open} onOpenChange={setOpen} repos={repos} activeWorktree={activeWorktree} onJump={(path) => void layout.getState().switchWorktree(path)} />
}

register({ id: 'worktree.jump', title: 'Jump to worktree', shortcut: '⌘J', run: () => jumpStore.getState().toggle() })

mountInSlot('overlay', ConnectedJumpPalette)
