import { invoke } from '@tauri-apps/api/core'
import { registerProvider, type ActionDef } from '../actions/registry'
import { saveSetting } from '../settings/app-store'
import { loadShells, shells, type Shells } from '../pty/shells'
import { onWindows } from '../pty/typed'

/** The palette's way to choose the shell new panes start (#360), one action per shell installed:
 *  Windows only, where `pty_shells` offers any. The choice is saved as `windowsShell`; the panes
 *  already open keep the shell they have. */
export function shellActions(s: Shells | null, choose: (id: string) => Promise<void>): ActionDef[] {
  if (!s || s.shells.length < 2) return []
  return s.shells.map((sh) => ({
    id: `terminal.shell.${sh.id}`,
    title: `New terminals start ${sh.label}${sh.id === s.current ? ' (current)' : ''}`,
    run: () => choose(sh.id),
  }))
}

const ask = () => invoke<Shells>('pty_shells')

if (onWindows()) {
  void loadShells(ask)
  registerProvider(() =>
    shellActions(shells(), async (id) => {
      await saveSetting('windowsShell', id)
      await loadShells(ask)
    }),
  )
}
