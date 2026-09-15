import type { Bounds } from './client'

/** Tauri 2 raises no event when a child webview takes keyboard focus, so it is inferred
 *  from the main webview: its document blurs while the native window stays focused
 *  (or the window gains focus without the document getting it), and the cursor sits
 *  over a browser page. The pane found is announced as `browser://focused/<paneId>`. */

export type Point = { x: number; y: number }

export const focusedEvent = (id: number) => `browser://focused/${id}`

/** The pane whose visible page contains `p` (CSS pixels of the main viewport). When the
 *  cursor cannot be read and exactly one page is on screen, that one: the click that
 *  moved focus into a child webview had to land on a visible page. */
export function pageAt(p: Point | null, pages: Iterable<[number, Bounds]>): number | null {
  const visible = [...pages].filter(([, b]) => b.w > 0 && b.h > 0)
  if (!p) return visible.length === 1 ? visible[0][0] : null
  const hit = visible.find(([, b]) => p.x >= b.x && p.x < b.x + b.w && p.y >= b.y && p.y < b.y + b.h)
  return hit ? hit[0] : null
}

export type WindowMetrics = {
  /** Screen cursor in physical px, scaled by the primary monitor (as tao reports it). */
  cursor: Point
  cursorScale: number
  /** The window's content view: origin and height in physical px, and its scale. */
  inner: Point
  innerHeight: number
  scale: number
  /** `window.innerHeight` of the main document, in CSS px. */
  viewportHeight: number
}

/** The cursor in main-viewport CSS pixels. On macOS the content view runs under the
 *  titlebar and WebKit insets the page below it, so the content view is taller than the
 *  viewport by the titlebar's height, all of it at the top. */
export function toViewport(m: WindowMetrics): Point {
  const top = Math.max(0, m.innerHeight / m.scale - m.viewportHeight)
  return {
    x: m.cursor.x / m.cursorScale - m.inner.x / m.scale,
    y: m.cursor.y / m.cursorScale - m.inner.y / m.scale - top,
  }
}

export interface FocusHost {
  /** Resolves true when the native window is the key window. */
  windowFocused(): Promise<boolean>
  /** Cursor in main-viewport CSS pixels, or null when it cannot be read. */
  cursor(): Promise<Point | null>
  documentFocused(): boolean
  /** Registers `cb` for the main document losing focus. */
  onBlur(cb: () => void): () => void
  /** Registers `cb` for the native window gaining focus. */
  onWindowFocus(cb: () => void): Promise<() => void>
  emit(event: string): void
}

/** Watches for focus moving into a page. `pages` lists the mounted browser panes' page
 *  rectangles at call time. Returns the unsubscribe. */
export function watchPageFocus(host: FocusHost, pages: () => Iterable<[number, Bounds]>): () => void {
  let seq = 0
  let stopped = false
  const check = async (needWindow: boolean) => {
    const mine = ++seq
    if (stopped || host.documentFocused()) return
    if (needWindow && !(await host.windowFocused())) return
    const p = await host.cursor().catch(() => null)
    // A later check supersedes this one, and focus may have come back meanwhile.
    if (stopped || mine !== seq || host.documentFocused()) return
    const id = pageAt(p, pages())
    if (id !== null) host.emit(focusedEvent(id))
  }
  const offBlur = host.onBlur(() => void check(true).catch(() => {}))
  // Activating the app by clicking straight into a page focuses the window, not the document.
  // The delay lets the document take focus back first when that is where it goes.
  const offWindow = host
    .onWindowFocus(() => setTimeout(() => void check(false).catch(() => {}), 50))
    .catch(() => () => {})
  return () => {
    stopped = true
    offBlur()
    void offWindow.then((off) => off())
  }
}
