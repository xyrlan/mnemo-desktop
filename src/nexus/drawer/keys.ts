import { claimAction } from '../../actions/registry'
import { detectPlatform, type Platform } from '../../actions/chords'
import type { Drawer } from './sessions'
import type { NexusState } from '../store'
import type { StoreApi } from 'zustand/vanilla'

/** ⌘\ (Ctrl+Shift+\ elsewhere, where plain Ctrl+\ is the shell's quit) collapses and expands the
 *  drawer. It is free in the chord table and bound here, inside the Nexus, like the view's other
 *  keys; it works from inside a tab's terminal too. */
export function isToggleKey(e: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>, platform: Platform = detectPlatform()): boolean {
  if (e.altKey) return false
  if (platform === 'mac') return e.metaKey && !e.ctrlKey && (e.key === '\\' || e.code === 'Backslash')
  return e.ctrlKey && e.shiftKey && !e.metaKey && (e.code === 'Backslash' || e.key === '|' || e.key === '\\')
}

export const toggleLabel = (platform: Platform = detectPlatform()) => (platform === 'mac' ? '⌘\\' : 'Ctrl+Shift+\\')

/** The drawer's root, which holds the keyboard when focus is inside it. */
export const DRAWER_SELECTOR = '[data-nexus-drawer]'

/** ⌘W while the drawer has the keyboard closes its tab shown, never the workbench's pane. */
export function claimClose(drawer: Drawer, store: StoreApi<NexusState>): () => void {
  return claimAction((id) => {
    if (id !== 'pane.close') return false
    const s = store.getState()
    if (!s.open || s.collapsed || !s.activeTab || !document.activeElement?.closest(DRAWER_SELECTOR)) return false
    void drawer.close(s.activeTab)
    return true
  })
}
