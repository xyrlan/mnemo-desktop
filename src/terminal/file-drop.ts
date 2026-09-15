import { getCurrentWebview } from '@tauri-apps/api/webview'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { store } from '../layout/app-store'
import type { PaneId } from '../layout/tree'
import { tauriPty } from '../pty/client'
import { dropText, fileDropStore } from './drop'

/** The live terminal pane under a point in CSS pixels, or null (another view, a divider, a
 *  broken or exited terminal). */
export function terminalAt(x: number, y: number): PaneId | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('.pane[data-pane]')
  const id = el ? Number(el.dataset.pane) : NaN
  const pane = Number.isFinite(id) ? store.getState().panes[id] : undefined
  return pane && pane.view === 'terminal' && id >= 0 && pane.exitCode === undefined && !pane.error ? id : null
}

type DropEvent = { type: 'enter' | 'over'; position: { x: number; y: number } } | { type: 'drop'; paths: string[]; position: { x: number; y: number } } | { type: 'leave' }

/** Tauri's drag-drop payload, with its physical position, applied to the panes: `over` names
 *  the terminal to highlight, a drop types the files' paths into it and focuses it. */
export function onFileDrag(e: DropEvent, scale = window.devicePixelRatio || 1): void {
  if (e.type === 'leave') return fileDropStore.setState({ over: null })
  const id = terminalAt(e.position.x / scale, e.position.y / scale)
  if (e.type !== 'drop') {
    if (fileDropStore.getState().over !== id) fileDropStore.setState({ over: id })
    return
  }
  fileDropStore.setState({ over: null })
  const text = dropText(e.paths)
  if (id === null || !text) return
  store.getState().focusPane(id)
  void tauriPty.write(id, text)
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
