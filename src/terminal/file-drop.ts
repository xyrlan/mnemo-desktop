import { getCurrentWebview } from '@tauri-apps/api/webview'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { store } from '../layout/app-store'
import { paneRects } from '../layout/rects'
import type { PaneId } from '../layout/tree'
import { tauriPty } from '../pty/client'
import { fileDrops, type DropSink, type FileDrops } from '../voice/files'
import { isVoiceNote } from '../voice/transcript'
import { dropTargetIn, dropTargetLive, dropText, fileDropStore, type DropTarget } from './drop'

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

/** A terminal that takes a drop's text, now or when a voice note's transcript is ready: gone once
 *  its pane exits or closes, or (a popup's, the drawer's PTY, in no pane) once a write to it fails. */
function ptySink(pty: PaneId, el: HTMLElement | null): DropSink {
  const known = store.getState().panes[pty] !== undefined
  return {
    el,
    alive: () => {
      const pane = store.getState().panes[pty]
      return known ? !!pane && pane.exitCode === undefined && !pane.error : pane?.exitCode === undefined
    },
    put: (text) => tauriPty.write(pty, text),
  }
}

function chatSink(chat: DropTarget): DropSink {
  return { el: chat.el, alive: () => dropTargetLive(chat), put: (text) => chat.insert(text) }
}

/** Puts a drop into `sink`: every path but a voice note's typed at once, as Terminal.app types
 *  them; each voice note's transcript after, in drop order, as it is ready (`../voice/files`). */
function dropInto(sink: DropSink, paths: string[], files: Pick<FileDrops, 'transcribe'>): void {
  const notes = paths.filter(isVoiceNote)
  const text = dropText(paths.filter((p) => !isVoiceNote(p)))
  if (text) void sink.put(text)
  if (notes.length) void files.transcribe(notes, sink)
}

/** The session host's presentation on top at a point (a popup, a drawer tab), as it marks its root
 *  with `data-session-pty`: the PTY it shows, null while it has none; undefined where none is. A
 *  pane under one never gets what is dropped on it. */
function presentationAt(x: number, y: number): { pty: PaneId | null; el: HTMLElement } | undefined {
  let top: { el: HTMLElement; z: number } | null = null
  for (const el of document.querySelectorAll<HTMLElement>('[data-session-pty]')) {
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) continue
    if (x < r.left || x >= r.left + r.width || y < r.top || y >= r.top + r.height) continue
    // The highest layer; of equals, the one drawn last.
    const z = Number(getComputedStyle(el).zIndex) || 0
    if (!top || z >= top.z) top = { el, z }
  }
  if (!top) return undefined
  const id = Number(top.el.dataset.sessionPty)
  return { pty: id > 0 ? id : null, el: top.el }
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
 *  puts the files' paths into its chat, else types them into its terminal, and focuses it. A voice
 *  note puts its transcript there instead of its path, once it is heard (`dropInto`). */
export function onFileDrag(e: DropEvent, scale = dropScale(), files: Pick<FileDrops, 'transcribe'> = fileDrops): void {
  if (e.type === 'leave') return fileDropStore.setState({ over: null })
  const x = e.position.x / scale
  const y = e.position.y / scale
  const shown = presentationAt(x, y)
  if (shown !== undefined) {
    // Over a popup or the drawer: its session takes the paths, typed as into a pane.
    fileDropStore.setState({ over: null })
    if (e.type !== 'drop') return
    if (shown.pty !== null && store.getState().panes[shown.pty]?.exitCode === undefined) dropInto(ptySink(shown.pty, shown.el), e.paths, files)
    return
  }
  const at = dropAt(x, y)
  if (e.type !== 'drop') {
    const id = at?.pane ?? null
    if (fileDropStore.getState().over !== id) fileDropStore.setState({ over: id })
    return
  }
  fileDropStore.setState({ over: null })
  if (at === null || !e.paths.some((p) => p.length > 0)) return
  store.getState().focusPane(at.pane)
  const el = document.querySelector<HTMLElement>(`.pane[data-pane="${at.pane}"]`)
  dropInto(at.chat ? chatSink(at.chat) : ptySink(at.pane, el), e.paths, files)
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
