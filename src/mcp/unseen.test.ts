import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createStore, DEFAULT_COLS, DEFAULT_ROWS } from '../layout/store'
import type { PtyClient } from '../pty/client'
import type { SessionClient } from '../terminal/sessions'
import { readUnseen, terminalReader, xtermEmulator, type Emulator } from './unseen'

const bytes = (t: string) => new TextEncoder().encode(t)

function fakePty() {
  let next = 1
  const outputs: Record<number, (b: Uint8Array) => void> = {}
  const resized: number[][] = []
  const pty: PtyClient = {
    spawn: async ({ onOutput }) => {
      const id = next++
      outputs[id] = onOutput
      return id
    },
    write: async () => {},
    resize: async (id, cols, rows) => void resized.push([id, cols, rows]),
    kill: async () => {},
    onExit: async () => () => {},
  }
  return { pty, outputs, resized }
}

/** The core: each terminal's screen as `attach` hands it, and whether its program runs. */
function core(screens: Record<number, string>, ended: number[] = []) {
  const attached: number[] = []
  const outputs: Record<number, (b: Uint8Array) => void> = {}
  const client: SessionClient = {
    list: async () => [],
    attach: async (id, onOutput) => {
      if (ended.includes(id)) throw new Error(`pane ${id} has exited`)
      attached.push(id)
      outputs[id] = onOutput
      return bytes(screens[id] ?? '')
    },
  }
  return { client, attached, outputs }
}

/** Text in, the lines it makes: enough of an emulator to see what was fed, in order. */
function fakeEmulator() {
  const made: { fed: string[]; disposed: boolean }[] = []
  const emulator = async (): Promise<Emulator> => {
    const e = { fed: [] as string[], disposed: false }
    made.push(e)
    return {
      write: (d, done) => {
        e.fed.push(typeof d === 'string' ? d : new TextDecoder().decode(d))
        done?.()
      },
      lines: () => e.fed.join('').split('\n'),
      dispose: () => void (e.disposed = true),
    }
  }
  return { emulator, made }
}

describe('readUnseen', () => {
  async function setup(screens: Record<number, string> = {}, ended: number[] = []) {
    const p = fakePty()
    const c = core(screens, ended)
    const layout = createStore(p.pty, { sessions: c.client })
    const id = await layout.getState().openOffscreen('/repo')
    const e = fakeEmulator()
    const read = () => readUnseen(id, { layout, emulator: e.emulator, cols: DEFAULT_COLS, rows: DEFAULT_ROWS, timeoutMs: 1_000 })
    return { ...p, c, layout, id, e, read }
  }

  it('a pane no view showed yet: what it printed so far, and the next view is drawn from the core', async () => {
    const s = await setup({ 1: 'screen now' })
    s.outputs[s.id](bytes('$ make\nok'))
    expect(await s.read()).toEqual(['$ make', 'ok'])
    expect(s.e.made[0].disposed).toBe(true)
    // Nothing of the read is left: no view, no owner, nothing kept.
    expect(s.layout.getState().owners[s.id]).toBeUndefined()
    expect(s.layout.getState().tracked()).toEqual([])
    const drawer: Uint8Array[] = []
    s.layout.getState().attachSink(s.id, (b) => drawer.push(b), true, 'drawer')
    await vi.waitFor(() => expect(new TextDecoder().decode(drawer[0])).toBe('screen now'))
  })

  it('a pane a view showed before: drawn from the core’s screen, again at every read', async () => {
    const s = await setup({ 1: 'claude\n> ' })
    s.layout.getState().attachSink(s.id, () => {}, true, 'drawer')()
    expect(await s.read()).toEqual(['claude', '> '])
    expect(await s.read()).toEqual(['claude', '> '])
    expect(s.c.attached).toEqual([s.id, s.id])
  })

  it('sizes nothing and never answers the program', async () => {
    const s = await setup()
    s.outputs[s.id](bytes('\x1b[6n'))
    await s.read()
    expect(s.resized).toEqual([])
  })

  it('a program that ended reads as empty', async () => {
    const s = await setup({}, [1])
    s.layout.getState().attachSink(s.id, () => {}, true, 'drawer')()
    expect(await s.read()).toEqual([''])
  })

  it('a drawer tab that opens meanwhile keeps the terminal, and the read gives way to it at once', async () => {
    const s = await setup({ 1: 'x' })
    s.layout.getState().attachSink(s.id, () => {}, true, 'drawer')()
    const reading = s.read()
    s.layout.getState().attachSink(s.id, () => {}, true, 'drawer')
    const started = Date.now()
    expect(await reading).toBeNull()
    expect(Date.now() - started).toBeLessThan(500)
    expect(s.layout.getState().owners[s.id]?.name).toBe('drawer')
  })

  it('null when the core’s screen does not come in time, and its view goes', async () => {
    const p = fakePty()
    const c = core({})
    c.client.attach = () => new Promise(() => {})
    const layout = createStore(p.pty, { sessions: c.client })
    const id = await layout.getState().openOffscreen('/repo')
    layout.getState().attachSink(id, () => {}, true, 'drawer')()
    const e = fakeEmulator()
    expect(await readUnseen(id, { layout, emulator: e.emulator, cols: DEFAULT_COLS, rows: DEFAULT_ROWS, timeoutMs: 20 })).toBeNull()
    expect(e.made[0].disposed).toBe(true)
    expect(layout.getState().owners[id]).toBeUndefined()
  })
})

describe('terminalReader', () => {
  it('reads a mounted view first, then an unseen pane with a view of its own, one read at a time', async () => {
    const shown: Record<number, string[]> = { 1: ['mounted'] }
    let calls = 0
    let finish: (l: string[] | null) => void = () => {}
    const read = terminalReader({
      shown: (id) => shown[id],
      unseen: (id) => id === 2,
      readUnseen: () => {
        calls++
        return new Promise((r) => (finish = r))
      },
    })
    expect(await read(1)).toEqual(['mounted'])
    expect(await read(3)).toBeUndefined()
    const a = read(2)
    const b = read(2)
    finish(['unseen'])
    expect(await a).toEqual(['unseen'])
    expect(await b).toEqual(['unseen'])
    expect(calls).toBe(1)
    // Not drawn in time: the view that took it is read.
    const c = read(2)
    shown[2] = ['taken']
    finish(null)
    expect(await c).toEqual(['taken'])
  })
})

describe('xtermEmulator', () => {
  // jsdom has no canvas, which xterm only measures with once it is opened.
  beforeAll(() => void vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null))
  afterAll(() => vi.restoreAllMocks())

  it('parses what it is fed into lines, at the size a screen says it was drawn at', async () => {
    const term = await xtermEmulator(20, 5)
    await new Promise<void>((r) => term.write('\x1b[8;5;40t' + 'x'.repeat(30) + '\r\n\x1b[31mred\x1b[m', r))
    expect(term.lines().filter((l) => l.trim())).toEqual(['x'.repeat(30), 'red'])
    term.dispose()
  })

  it('joins a soft-wrapped line back whole', async () => {
    const term = await xtermEmulator(10, 5)
    await new Promise<void>((r) => term.write('y'.repeat(25), r))
    expect(term.lines()[0]).toBe('y'.repeat(25))
    term.dispose()
  })
})
