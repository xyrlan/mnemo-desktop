import type { StoreApi } from 'zustand/vanilla'
import { register as registerAction, type Action } from '../actions/registry'
import { shellStore, type ShellState } from './store'

/** The shell's actions: open and close each sidebar. Their chords (Mod+B, Mod+L) are the
 *  keymap's to bind; `shortcut` is what the palette shows beside them. */
export function registerShellActions(shell: StoreApi<ShellState> = shellStore, register: (a: Action) => void = registerAction) {
  register({ id: 'sidebar.toggle-left', title: 'Toggle left sidebar', shortcut: '⌘B', run: () => shell.getState().toggleLeft() })
  register({ id: 'sidebar.toggle-right', title: 'Toggle right sidebar', shortcut: '⌘L', run: () => shell.getState().toggleRight() })
}
