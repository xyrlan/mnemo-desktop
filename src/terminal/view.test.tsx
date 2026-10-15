import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { PtyInfo, SessionClient } from './sessions'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// A popup over a pane (#421), through the real terminal view: xterm, its addons and Tauri are
// stand-ins. Each fake terminal fits the box it is opened in, whose size is on `data-box`.

type Handler = (params: (number | number[])[]) => boolean

const { resizes, terms, FakeTerminal, core } = vi.hoisted(() => {
  const resizes: [number, number, number][] = []
  /** The core: terminal 1 runs, and draws as `screen` says (its size first). */
  const core = { screen: '', onOutput: null as ((b: Uint8Array) => void) | null }
  class FakeTerminal {
    cols = 80
    rows = 24
    el: HTMLElement | null = null
    written = ''
    options = { fontFamily: 'mono', fontSize: 13 }
    buffer = { active: { length: 0, getLine: () => undefined } }
    csi: Handler[] = []
    parser = {
      registerCsiHandler: (_: unknown, h: Handler) => (this.csi.push(h), { dispose() {} }),
      registerOscHandler: () => ({ dispose() {} }),
    }
    constructor() {
      terms.push(this)
    }
    open(el: HTMLElement) {
      this.el = el
    }
    loadAddon(a: { activate?: (t: FakeTerminal) => void }) {
      a.activate?.(this)
    }
    write(b: Uint8Array, done?: () => void) {
      const t = new TextDecoder().decode(b)
      this.written += t
      const m = /\x1b\[8;(\d+);(\d+)t/.exec(t)
      if (m) for (const h of this.csi) h([8, Number(m[1]), Number(m[2])])
      done?.()
    }
    resize(cols: number, rows: number) {
      this.cols = cols
      this.rows = rows
    }
    box() {
      const [cols, rows] = (this.el?.closest<HTMLElement>('[data-box]')?.dataset.box ?? '0x0').split('x').map(Number)
      return { cols, rows }
    }
    attachCustomKeyEventHandler() {}
    onData = () => ({ dispose() {} })
    onKey = () => ({ dispose() {} })
    onTitleChange = () => ({ dispose() {} })
    hasSelection = () => false
    focus() {}
    dispose() {}
  }
  const terms: FakeTerminal[] = []
  return { resizes, terms, FakeTerminal, core }
})
type FakeTerminal = InstanceType<typeof FakeTerminal>

vi.mock('../pty/client', () => ({
  tauriPty: {
    spawn: async () => 1,
    write: async () => {},
    resize: async (id: number, cols: number, rows: number) => void resizes.push([id, cols, rows]),
    kill: async () => {},
    onExit: async () => () => {},
  },
}))
vi.mock('@xterm/xterm', () => ({ Terminal: FakeTerminal }))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    term: FakeTerminal | null = null
    activate(t: FakeTerminal) {
      this.term = t
    }
    proposeDimensions() {
      return this.term?.box()
    }
    fit() {
      const b = this.term!.box()
      this.term!.resize(b.cols, b.rows)
    }
  },
}))
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: class { onContextLoss() {} } }))
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }))
vi.mock('./fonts', () => ({ loadFaces: async () => {}, onFaces: () => () => {}, redraw: () => {}, track: () => () => {} }))
vi.mock('./file-drop', () => ({ holdFileDrop: () => () => {} }))
vi.mock('./shell-choice', () => ({}))
vi.mock('../conversation/Face', () => ({ default: () => null }))
vi.mock('../github/actions', () => ({ openUrl: async () => {} }))
vi.mock('../layout/app-store', async () => {
  const { createStore } = await import('../layout/store')
  const { useStore } = await import('zustand')
  const { tauriPty } = await import('../pty/client')
  const sessions: SessionClient = {
    list: async (): Promise<PtyInfo[]> => [{ id: 1, cwd: '/a', pid: 9, alive: true }],
    attach: async (_id, onOutput) => {
      core.onOutput = onOutput
      return new TextEncoder().encode(core.screen)
    },
  }
  const store = createStore(tauriPty, { sessions })
  return { store, useApp: (sel: (s: unknown) => unknown) => useStore(store, sel as never) }
})

/** Each view's box observer, by the box it watches: a test resizes the box and calls it. */
const observers = new Map<Element, () => void>()
globalThis.ResizeObserver = class {
  constructor(private cb: () => void) {}
  observe(el: Element) {
    observers.set(el, this.cb)
  }
  disconnect() {}
} as unknown as typeof ResizeObserver

import TerminalPane from './view'
import { store } from '../layout/app-store'

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))
const bytes = (t: string) => new TextEncoder().encode(t)

function mount(box: string, over: boolean): { root: Root; term: FakeTerminal; host: HTMLElement } {
  const host = document.body.appendChild(document.createElement('div'))
  host.dataset.box = box
  const root = createRoot(host)
  const before = terms.length
  act(() => root.render(<TerminalPane id={1} props={over ? { over: true } : {}} />))
  return { root, term: terms[before], host }
}

test('a popup takes the shell to its size, and the pane under it gets its screen and its size back when it closes', async () => {
  store.setState({ panes: { 1: { id: 1, view: 'terminal' } } })
  const pane = mount('100x30', false)
  expect(resizes.at(-1)).toEqual([1, 100, 30])

  // The popup is drawn from the core's screen at the pane's size, then fits its own box.
  core.screen = '\x1b[8;30;100tclaude ❯'
  const popup = mount('140x40', true)
  await settle()
  expect(popup.term.written).toBe('\x1bc\x1b[8;30;100tclaude ❯')
  expect(resizes.at(-1)).toEqual([1, 140, 40])

  // Under the popup the pane never sizes the shell, even when its own box changes.
  const n = resizes.length
  pane.host.dataset.box = '90x20'
  act(() => observers.get(pane.term.el!)!())
  expect(pane.term.cols).toBe(90)
  expect(resizes.length).toBe(n)
  pane.host.dataset.box = '100x30'

  // Live output goes to the popup only.
  const before = pane.term.written
  core.onOutput!(bytes(' typed'))
  expect(popup.term.written.endsWith(' typed')).toBe(true)
  expect(pane.term.written).toBe(before)

  // Closed: the pane is drawn again from the screen as it is now, at the popup's size, then fits
  // its own box and sizes the shell back.
  core.screen = '\x1b[8;40;140tclaude ❯ typed'
  act(() => popup.root.unmount())
  await settle()
  expect(pane.term.written.endsWith('\x1bc\x1b[8;40;140tclaude ❯ typed')).toBe(true)
  expect(pane.term.cols).toBe(100)
  expect(resizes.at(-1)).toEqual([1, 100, 30])
  core.onOutput!(bytes('!'))
  expect(pane.term.written.endsWith('typed!')).toBe(true)
  act(() => pane.root.unmount())
})
