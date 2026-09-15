import type { PaneId } from '../layout/tree'

/** What a terminal pane has on screen and in scrollback, one logical line per entry. */
export type BufferReader = () => string[]

const readers = new Map<PaneId, BufferReader>()

/** A mounted terminal pane offers its buffer to readers outside the view (the desktop MCP).
 *  Returns the unregister function; it only removes this reader, so a StrictMode remount
 *  that registered again first is left alone. */
export function registerBuffer(paneId: PaneId, read: BufferReader): () => void {
  readers.set(paneId, read)
  return () => {
    if (readers.get(paneId) === read) readers.delete(paneId)
  }
}

/** The pane's lines, or undefined when no terminal view is mounted for it. */
export function readBuffer(paneId: PaneId): string[] | undefined {
  return readers.get(paneId)?.()
}

/** The last `n` lines, not counting the blank rows below the cursor. */
export function tail(lines: string[], n: number): string[] {
  let end = lines.length
  while (end > 0 && lines[end - 1].trim() === '') end--
  return lines.slice(Math.max(0, end - Math.max(0, Math.floor(n))), end)
}

/** The slice of xterm's `IBuffer` this module reads, so tests need no Terminal. */
export type RowBuffer = {
  length: number
  getLine(y: number): { isWrapped: boolean; translateToString(trimRight?: boolean): string } | undefined
}

/** Rows joined into logical lines: a row xterm soft-wrapped continues the one above,
 *  so a long command or URL reads back whole. Only a line's last row is right-trimmed,
 *  since spaces at a wrap point belong to the text. */
export function bufferLines(buf: RowBuffer): string[] {
  const out: string[] = []
  for (let y = 0; y < buf.length; y++) {
    const row = buf.getLine(y)
    if (!row) continue
    const next = buf.getLine(y + 1)
    const text = row.translateToString(!next?.isWrapped)
    if (row.isWrapped && out.length > 0) out[out.length - 1] += text
    else out.push(text)
  }
  return out
}
