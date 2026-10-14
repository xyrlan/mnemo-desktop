import type { Platform } from './chords'

/** The app's webview is an app, not a web page. Off a Mac (WebView2, WebKitGTK) the browser's
 *  own keys and context menu acted on it: F5 and Ctrl+R reloaded the app, Ctrl+F and Ctrl+P
 *  opened Edge's find bar and print dialog, and a right-click on bare UI offered Back, Refresh,
 *  Save as and Print. On Windows the host also turns those keys off natively
 *  (`src-tauri/src/browser_keys.rs`); this holds them back from here too.
 *
 *  A browser pane's page is a webview of its own and keeps all of them. */

type KeyEvent = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>

/** WebView2's browser keys: reload, find, print, save, view source, caret browsing, back and
 *  forward, and the keyboard's own browser keys. */
export function browserKey(e: KeyEvent): boolean {
  if (e.metaKey) return false
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
  if (/^Browser/.test(k)) return true
  if (!e.ctrlKey && !e.altKey && (k === 'F3' || k === 'F5' || k === 'F7')) return true
  if (e.ctrlKey && !e.altKey && k === 'F5') return true
  if (e.altKey && !e.ctrlKey && !e.shiftKey && (k === 'ArrowLeft' || k === 'ArrowRight')) return true
  if (e.ctrlKey && !e.altKey && !e.shiftKey && ['f', 'g', 'p', 'r', 's', 'u'].includes(k)) return true
  // Ctrl+Shift+G is the app's diff chord, which its own handler takes first.
  return e.ctrlKey && !e.altKey && e.shiftKey && ['g', 'r'].includes(k)
}

type Target = { closest?: (selector: string) => unknown } | null

/** Where the webview's own context menu stays: in a field (cut, copy, paste), in the terminal
 *  (its copy and paste), and on selected text (copy). */
const KEEPS_MENU = 'input, textarea, [contenteditable=""], [contenteditable="true"], .xterm'

export function keepsContextMenu(target: Target, selection: string): boolean {
  if (selection.trim() !== '') return true
  return !!target?.closest?.(KEEPS_MENU)
}

/** Holds back the browser's keys and context menu in the app's webview off a Mac. Listens in
 *  the bubble phase and only cancels the default, so whatever handles a key first (the
 *  terminal, an editor's own find, the app's chords) still gets it. `keepMenu` keeps the
 *  context menu everywhere: in a dev build, for Inspect. */
export function installNotAPage(platform: Platform, { keepMenu = false }: { keepMenu?: boolean } = {}): () => void {
  if (platform === 'mac') return () => {}
  const onKey = (e: KeyboardEvent) => {
    if (browserKey(e)) e.preventDefault()
  }
  const onMenu = (e: MouseEvent) => {
    if (keepMenu || e.defaultPrevented) return
    if (!keepsContextMenu(e.target as Target, window.getSelection()?.toString() ?? '')) e.preventDefault()
  }
  window.addEventListener('keydown', onKey)
  window.addEventListener('contextmenu', onMenu)
  return () => {
    window.removeEventListener('keydown', onKey)
    window.removeEventListener('contextmenu', onMenu)
  }
}
