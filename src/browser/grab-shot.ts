// adapted from stablyai/orca src/main/browser/browser-grab-screenshot.ts (MIT, 122b8c25)
import type { GrabRect } from './grab-payload'

/** The picked element's screenshot: the pane's page is captured whole (`mcp_browser_snapshot`,
 *  a WKWebView snapshot of what the pane shows) and cut down to the element here. */

export type Snapshot = { mime: string; data: string }
export type Box = { x: number; y: number; w: number; h: number }

/** CSS pixels of margin kept around the element, so its edges read in the crop. */
export const SHOT_MARGIN = 4

/** Where the element is in the snapshot's bitmap. The snapshot is in device pixels and the
 *  rect in CSS pixels; the scale is read off the two widths rather than assumed, so it holds
 *  on any display. The part of the element outside the viewport is not in the snapshot and
 *  is cut off; null when nothing of it is on screen. */
export function cropBox(rect: GrabRect, viewportWidth: number, image: { width: number; height: number }): Box | null {
  const finite = [rect.x, rect.y, rect.width, rect.height, viewportWidth].every(Number.isFinite)
  if (!finite || viewportWidth <= 0 || image.width <= 0 || image.height <= 0) return null
  const scale = image.width / viewportWidth
  const x0 = Math.max(0, Math.round((rect.x - SHOT_MARGIN) * scale))
  const y0 = Math.max(0, Math.round((rect.y - SHOT_MARGIN) * scale))
  const x1 = Math.min(image.width, Math.round((rect.x + rect.width + SHOT_MARGIN) * scale))
  const y1 = Math.min(image.height, Math.round((rect.y + rect.height + SHOT_MARGIN) * scale))
  if (x1 - x0 <= 0 || y1 - y0 <= 0) return null
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** Cuts `snap` down to the element and returns the PNG, base64. Rejects with why when the
 *  element is not on screen or the image does not decode. */
export async function cropShot(snap: Snapshot, rect: GrabRect, viewportWidth: number): Promise<string> {
  const bytes = Uint8Array.from(atob(snap.data), (c) => c.charCodeAt(0))
  const bitmap = await createImageBitmap(new Blob([bytes], { type: snap.mime }))
  try {
    const box = cropBox(rect, viewportWidth, bitmap)
    if (!box) throw new Error('the element is not on screen')
    const canvas = document.createElement('canvas')
    canvas.width = box.w
    canvas.height = box.h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no canvas to crop the screenshot on')
    ctx.drawImage(bitmap, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h)
    const url = canvas.toDataURL('image/png')
    return url.slice(url.indexOf(',') + 1)
  } finally {
    bitmap.close()
  }
}
