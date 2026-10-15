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

/** A session popup's root (`src/popout/Popouts.tsx`). */
const POPUP_SELECTOR = '[data-popout]'

/** ⌘W and ⇧⌘W while the Nexus is open close the drawer's tab shown, or nothing: never the
 *  workbench's pane or tab hidden under the Nexus, whose shell they would kill. Wherever the focus
 *  is (the ship, the quick diff, a read-only tab, nowhere WKWebView would focus). A popup over the
 *  Nexus still closes itself on ⌘W (`src/popout/view.tsx`). */
export function claimClose(drawer: Drawer, store: StoreApi<NexusState>): () => void {
  return claimAction((id) => {
    if (id !== 'pane.close' && id !== 'tab.close') return false
    const s = store.getState()
    if (!s.open) return false
    if (id === 'pane.close' && document.activeElement?.closest(POPUP_SELECTOR)) return false
    if (!s.collapsed && s.activeTab) void drawer.close(s.activeTab)
    return true
  })
}

/** The drawer's root (`Drawer.tsx`). */
const DRAWER_SELECTOR = '[data-nexus-drawer]'

/** ⌘⇧C (`pane.toggle-face`) while the drawer has the keyboard flips its tab shown between its
 *  conversation and its terminal, as it flips a pane's face in the workbench, whose focused pane
 *  under the Nexus it would flip otherwise. A read-only tab has no terminal: the chord does nothing
 *  there. With the focus anywhere else (the ship, a popup), the chord is not the drawer's. */
export function claimFace(store: StoreApi<NexusState>): () => void {
  return claimAction((id) => {
    if (id !== 'pane.toggle-face') return false
    const s = store.getState()
    if (!s.open || s.collapsed || !s.activeTab || !document.activeElement?.closest(DRAWER_SELECTOR)) return false
    if (s.tabs.find((t) => t.id === s.activeTab)?.key) s.toggleFace(s.activeTab)
    return true
  })
}
