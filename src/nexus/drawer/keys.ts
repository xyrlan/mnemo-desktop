import { claimAction } from '../../actions/registry'
import { detectPlatform, type Platform } from '../../actions/chords'
import type { Drawer } from './sessions'
import type { NexusState } from '../store'
import type { StoreApi } from 'zustand/vanilla'
import { dismissConfirm } from '../ui/confirm'
import { closeWindow, windowStore } from '../ui/windows'

/** ⌘\ (Ctrl+Shift+\ elsewhere, where plain Ctrl+\ is the shell's quit) collapses and expands the
 *  drawer. It is free in the chord table and bound here, inside the Nexus, like the view's other
 *  keys; it works from inside a tab's terminal too. */
export function isToggleKey(e: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>, platform: Platform = detectPlatform()): boolean {
  if (e.altKey) return false
  if (platform === 'mac') return e.metaKey && !e.ctrlKey && (e.key === '\\' || e.code === 'Backslash')
  return e.ctrlKey && e.shiftKey && !e.metaKey && (e.code === 'Backslash' || e.key === '|' || e.key === '\\')
}

export const toggleLabel = (platform: Platform = detectPlatform()) => (platform === 'mac' ? '⌘\\' : 'Ctrl+Shift+\\')

/** ⌘W and ⇧⌘W close what is on top: a confirmation (as Cancel), else the window open over the
 *  ship, else the drawer's tab shown, or nothing: never a pane the app runs with no tab, whose shell
 *  they would kill, nor a tab under a window. Wherever the focus is (the ship, the quick diff, a
 *  read-only tab, nowhere WKWebView would focus). */
export function claimClose(drawer: Drawer, store: StoreApi<NexusState>): () => void {
  return claimAction((id) => {
    if (id !== 'pane.close' && id !== 'tab.close') return false
    const s = store.getState()
    if (dismissConfirm()) return true
    if (windowStore.getState().open) closeWindow()
    else if (!s.collapsed && s.activeTab) void drawer.close(s.activeTab)
    return true
  })
}
