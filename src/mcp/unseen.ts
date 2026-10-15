import type { PaneId } from '../layout/tree'
import type { State, Actions } from '../layout/store'
import type { StoreApi } from 'zustand/vanilla'
import { bufferLines } from '../terminal/buffer'
import { resizeRequest } from '../terminal/reattach'

/** A terminal emulator drawn nowhere: what a terminal shows, for a reader that has no view of it. */
export type Emulator = {
  /** `done` once `data` is parsed; writes are parsed in order. */
  write(data: Uint8Array | string, done?: () => void): void
  lines(): string[]
  dispose(): void
}

export type UnseenDeps = {
  layout: StoreApi<Pick<State, 'owners'> & Pick<Actions, 'attachSink' | 'showSink'>>
  emulator: (cols: number, rows: number) => Promise<Emulator>
  cols: number
  rows: number
  /** How long the core's screen may take to arrive. */
  timeoutMs: number
}

/** What the view of an MCP read calls itself (`owners[id].name` while it owns the terminal). */
export const VIEW_NAME = 'desktop-mcp'

/** The lines of terminal `id` while no view of it is mounted (an offscreen pane no drawer tab
 *  shows): a view of its own joins it for the read, as the drawer's would, drawn from the core's
 *  screen or the output kept for the first view, then goes. It sizes nothing and never takes the
 *  terminal from a view on screen. Null when another view took it first (one that mounted
 *  meanwhile: read that one), or it was not drawn in time. */
export async function readUnseen(id: PaneId, d: UnseenDeps): Promise<string[] | null> {
  const term = await d.emulator(d.cols, d.rows)
  const sink = (b: Uint8Array) => term.write(b)
  const release = d.layout.getState().attachSink(id, sink, false, VIEW_NAME)
  d.layout.getState().showSink(id, sink, false)
  try {
    // Drawn once it owns the terminal: at once from the output kept, or once the core's screen
    // came (`seed` in the layout store).
    if (!(await owned(d.layout, id, sink, d.timeoutMs))) return null
    await new Promise<void>((r) => term.write('', r))
    return term.lines()
  } finally {
    release()
    term.dispose()
  }
}

/** True once the view of `sink` owns terminal `id`; false once another view does (one that mounted
 *  meanwhile, which has the lines), or after `ms`. */
function owned(layout: UnseenDeps['layout'], id: PaneId, sink: (b: Uint8Array) => void, ms: number): Promise<boolean> {
  const owner = () => layout.getState().owners[id]?.sink
  const settled = () => (owner() === undefined ? null : owner() === sink)
  const now = settled()
  if (now !== null) return Promise.resolve(now)
  return new Promise((resolve) => {
    const done = (v: boolean) => {
      clearTimeout(timer)
      unwatch()
      resolve(v)
    }
    const unwatch = layout.subscribe(() => {
      const v = settled()
      if (v !== null) done(v)
    })
    const timer = setTimeout(() => done(false), ms)
  })
}

/** xterm, never opened: it parses and keeps a buffer with nothing to draw into. A shell attached
 *  again opens with `CSI 8 ; rows ; cols t`, the size its screen was drawn at, which it takes. */
export async function xtermEmulator(cols: number, rows: number): Promise<Emulator> {
  // Loaded here, not at the top: nothing else on this path needs a terminal emulator.
  const { Terminal } = await import('@xterm/xterm')
  const term = new Terminal({ cols, rows, scrollback: 10_000, allowProposedApi: true })
  term.parser.registerCsiHandler({ final: 't' }, (params) => {
    const size = resizeRequest(params)
    if (!size) return false
    term.resize(size.cols, size.rows)
    return true
  })
  return {
    write: (data, done) => term.write(data, done),
    lines: () => bufferLines(term.buffer.active),
    dispose: () => term.dispose(),
  }
}

export type ReaderDeps = {
  /** The lines of a terminal view mounted for `id` (`readBuffer`), undefined with none. */
  shown(id: PaneId): string[] | undefined
  /** Whether `id` may be read with a view of its own: an offscreen pane, whose next view is drawn
   *  from the core's screen whatever this read takes. A workbench pane's kept output is not. */
  unseen(id: PaneId): boolean
  readUnseen(id: PaneId): Promise<string[] | null>
}

/** Reads a terminal shown or not: through a view of it that is mounted, else with one of its own
 *  (`readUnseen`), one at a time per terminal (a second read waits for the first's lines). */
export function terminalReader(d: ReaderDeps): (id: PaneId) => Promise<string[] | undefined> {
  const reading = new Map<PaneId, Promise<string[] | undefined>>()
  return (id) => {
    const lines = d.shown(id)
    if (lines) return Promise.resolve(lines)
    if (!d.unseen(id)) return Promise.resolve(undefined)
    let read = reading.get(id)
    if (!read) {
      read = d
        .readUnseen(id)
        .then((l) => l ?? d.shown(id))
        .finally(() => reading.delete(id))
      reading.set(id, read)
    }
    return read
  }
}
