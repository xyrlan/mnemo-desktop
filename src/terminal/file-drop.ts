import { getCurrentWebview } from '@tauri-apps/api/webview'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { store } from '../layout/app-store'
import { paneRects } from '../layout/rects'
import type { PaneId } from '../layout/tree'
import { tauriPty } from '../pty/client'
import { dropTargetIn, dropText, fileDropStore, type DropTarget } from './drop'

/** The live terminal pane under a point in CSS pixels, or null (another view, a divider, a
 *  broken or exited terminal). Uses each pane's real rect rather than
 *  `elementFromPoint`, which returns the topmost element at the point — an overlay, or a
 *  child of a pane that is not under the cursor when panes are split. */
export function terminalAt(x: number, y: number): PaneId | null {
  for (const [id, r] of paneRects()) {
    if (r.w <= 0 || r.h <= 0) continue
    if (x < r.x || x >= r.x + r.w || y < r.y || y >= r.y + r.h) continue
    const pane = store.getState().panes[id]
    // A rect that does not qualify (a stale one, another view) does not end the search.
    if (pane && pane.view === 'terminal' && pane.exitCode === undefined && !pane.error) return id
  }
  return null
}

/** Where files dropped at a point go: the chat of the pane under it when one shows there (a
 *  terminal's conversation face, a child's chat), else the live terminal under it; null for
 *  anything else. The chat comes first: typed into the PTY under a conversation face, the paths
 *  would sit unseen in Claude Code's input and ride along with the next message. */
function dropAt(x: number, y: number): { pane: PaneId; chat: DropTarget | null } | null {
  const terminal = terminalAt(x, y)
  for (const el of document.querySelectorAll<HTMLElement>('.pane[data-pane]')) {
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) continue
    if (x < r.left || x >= r.left + r.width || y < r.top || y >= r.top + r.height) continue
    const chat = dropTargetIn(el)
    if (chat) return { pane: Number(el.dataset.pane), chat }
  }
  return terminal === null ? null : { pane: terminal, chat: null }
}

type DropEvent = { type: 'enter' | 'over'; position: { x: number; y: number } } | { type: 'drop'; paths: string[]; position: { x: number; y: number } } | { type: 'leave' }

/** What divides Tauri's drop position into CSS pixels. The position is relative to the
 *  webview on every platform (never the screen, so no window origin to subtract), but its
 *  unit differs despite the `PhysicalPosition` type: wry reports AppKit points on macOS
 *  (`draggingLocation`) and GTK widget coordinates on Linux, both already logical, and
 *  only on Windows physical client pixels (`ScreenToClient`). */
export function dropScale(platform = navigator.platform, dpr = window.devicePixelRatio || 1): number {
  return /^win/i.test(platform) ? dpr : 1
}

/** Tauri's drag-drop payload applied to the panes: `over` names the pane to highlight, a drop
 *  puts the files' paths into its chat, else types them into its terminal, and focuses it. */
export function onFileDrag(e: DropEvent, scale = dropScale()): void {
  if (e.type === 'leave') return fileDropStore.setState({ over: null })
  const at = dropAt(e.position.x / scale, e.position.y / scale)
  if (e.type !== 'drop') {
    const id = at?.pane ?? null
    if (fileDropStore.getState().over !== id) fileDropStore.setState({ over: id })
    return
  }
  fileDropStore.setState({ over: null })
  const text = dropText(e.paths)
  if (at === null || !text) return
  store.getState().focusPane(at.pane)
  if (at.chat) at.chat.insert(text)
  else void tauriPty.write(at.pane, text)
}

let users = 0
let unlisten: Promise<UnlistenFn | null> | null = null

/** One webview listener shared by every mounted terminal pane; returns the release. The
 *  webview delivers native file drags only through this event (HTML5 drop never fires). */
export function holdFileDrop(): () => void {
  if (users++ === 0) {
    unlisten = (async () => {
      try {
        return await getCurrentWebview().onDragDropEvent((ev) => onFileDrag(ev.payload))
      } catch (err) {
        console.warn('file drop unavailable', err)
        return null
      }
    })()
  }
  let released = false
  return () => {
    if (released) return
    released = true
    if (--users > 0) return
    const u = unlisten
    unlisten = null
    fileDropStore.setState({ over: null })
    void u?.then((f) => f?.())
  }
}
