import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { PtyInfo, SessionClient } from './sessions'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// A pane and a popup showing the same terminal (#421, #423), through the real terminal view: xterm,
// its addons and Tauri are stand-ins. Each fake terminal fits the box it is opened in, whose size is
// on `data-box`.

type Handler = (params: (number | number[])[]) => boolean

const { resizes, writes, terms, FakeTerminal, core } = vi.hoisted(() => {
  const resizes: [number, number, number][] = []
  const writes: [number, string][] = []
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
    data: ((d: string) => void) | null = null
    onData = (cb: (d: string) => void) => ((this.data = cb), { dispose() {} })
    onKey = () => ({ dispose() {} })
    onTitleChange = () => ({ dispose() {} })
    hasSelection = () => false
    focus() {}
    dispose() {}
  }
  const terms: FakeTerminal[] = []
  return { resizes, writes, terms, FakeTerminal, core }
})
type FakeTerminal = InstanceType<typeof FakeTerminal>

vi.mock('../pty/client', () => ({
  tauriPty: {
    spawn: async () => 1,
    write: async (id: number, d: string) => void writes.push([id, d]),
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

function mount(box: string, props: Record<string, unknown> = {}): { root: Root; term: FakeTerminal; host: HTMLElement } {
  const host = document.body.appendChild(document.createElement('div'))
  host.dataset.box = box
  const root = createRoot(host)
  const before = terms.length
  act(() => root.render(<TerminalPane id={1} props={props} />))
  return { root, term: terms[before], host }
}
const POPUP = { present: true }
/** The box of a view changed (a drawer tab hidden is 0x0): its observer sees it. */
function boxed(v: { host: HTMLElement; term: FakeTerminal }, box: string) {
  v.host.dataset.box = box
  act(() => observers.get(v.term.el!)!())
}
const veiled = (v: { host: HTMLElement }) => v.host.querySelector('[data-veil]') !== null

beforeEach(() => {
  store.setState({ panes: { 1: { id: 1, view: 'terminal' } } })
  resizes.length = 0
  writes.length = 0
})

test('a popup takes the shell to its size; the pane under it draws every byte at that size, veiled, and gets the shell back when it closes', async () => {
  const pane = mount('100x30')
  expect(resizes.at(-1)).toEqual([1, 100, 30])
  expect(veiled(pane)).toBe(false)

  // The popup is drawn from the core's screen at the pane's size, then fits its own box.
  core.screen = '\x1b[8;30;100tclaude ❯'
  const popup = mount('140x40', POPUP)
  await settle()
  expect(popup.term.written).toBe('\x1b[8;30;100tclaude ❯')
  expect(resizes.at(-1)).toEqual([1, 140, 40])
  expect(veiled(popup)).toBe(false)
  expect(veiled(pane)).toBe(true)
  // The pane draws at the shell's size, whatever its own box, and never sizes the shell.
  expect([pane.term.cols, pane.term.rows]).toEqual([140, 40])
  const n = resizes.length
  boxed(pane, '90x20')
  expect([pane.term.cols, pane.term.rows]).toEqual([140, 40])
  expect(resizes.length).toBe(n)
  boxed(pane, '100x30')

  // Live output reaches both; only the popup types into the shell.
  const before = pane.term.written
  core.onOutput!(bytes(' typed'))
  expect(popup.term.written.endsWith(' typed')).toBe(true)
  expect(pane.term.written).toBe(before + ' typed')
  pane.term.data!('\x1b[2;1R')
  popup.term.data!('x')
  expect(writes).toEqual([[1, 'x']])

  // Closed: the pane owns the shell again, with nothing drawn anew, fits its own box, and sizes
  // the shell back.
  act(() => popup.root.unmount())
  await settle()
  expect(pane.term.written).toBe(before + ' typed')
  expect(pane.term.written).not.toContain('\x1bc')
  expect([pane.term.cols, pane.term.rows]).toEqual([100, 30])
  expect(resizes.at(-1)).toEqual([1, 100, 30])
  expect(veiled(pane)).toBe(false)
  core.onOutput!(bytes('!'))
  expect(pane.term.written.endsWith('typed!')).toBe(true)
  act(() => pane.root.unmount())
})

test('a veiled view takes the shell back with "Show here", and gives it again the same way, with no remount', async () => {
  const pane = mount('100x30')
  const popup = mount('140x40', POPUP)
  await settle()
  const made = terms.length
  act(() => pane.host.querySelector<HTMLButtonElement>('[data-veil] button')!.click())
  expect(veiled(pane)).toBe(false)
  expect(veiled(popup)).toBe(true)
  expect(resizes.at(-1)).toEqual([1, 100, 30])
  expect([popup.term.cols, popup.term.rows]).toEqual([100, 30])
  act(() => popup.host.querySelector<HTMLButtonElement>('[data-veil] button')!.click())
  expect(resizes.at(-1)).toEqual([1, 140, 40])
  expect(veiled(pane)).toBe(true)
  expect(terms.length).toBe(made)
  act(() => popup.root.unmount())
  act(() => pane.root.unmount())
})

test('a view hidden while it owns the shell (a drawer tab not shown) hands it to the one on screen', async () => {
  const pane = mount('100x30')
  const drawer = mount('60x40', POPUP)
  await settle()
  expect(resizes.at(-1)).toEqual([1, 60, 40])
  boxed(drawer, '0x0')
  expect(veiled(pane)).toBe(false)
  expect(resizes.at(-1)).toEqual([1, 100, 30])
  // Shown again, the drawer says the shell is shown elsewhere until it is asked to take it.
  boxed(drawer, '60x40')
  expect(veiled(drawer)).toBe(true)
  expect(resizes.at(-1)).toEqual([1, 100, 30])
  act(() => drawer.root.unmount())
  act(() => pane.root.unmount())
})

test('a key after the program exited closes the popup showing it, never a pane', async () => {
  const closePane = vi.fn(async () => {})
  store.setState({ panes: { 1: { id: 1, view: 'terminal', exitCode: 0 } }, closePane })
  const pane = mount('100x30')
  const close = vi.fn()
  const popup = mount('140x40', { present: true, close })
  await settle()
  act(() => popup.host.querySelector<HTMLElement>('.pane-body')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true })))
  expect(close).toHaveBeenCalledTimes(1)
  expect(closePane).not.toHaveBeenCalled()
  // The pane's own view closes its own pane, by id.
  act(() => pane.host.querySelector<HTMLElement>('.pane-body')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true })))
  expect(closePane).toHaveBeenCalledWith(1)
  act(() => popup.root.unmount())
  act(() => pane.root.unmount())
})

test('a drawer tab shown again takes its session back when it turns active, with no remount', async () => {
  const pane = mount('100x30')
  const drawer = mount('60x40', { present: true, name: 'drawer:1', active: true })
  await settle()
  expect(store.getState().owners[1].name).toBe('drawer:1')
  // Another tab shows: this one is hidden, and the pane on screen gets the shell.
  act(() => drawer.root.render(<TerminalPane id={1} props={{ present: true, name: 'drawer:1', active: false }} />))
  boxed(drawer, '0x0')
  expect(resizes.at(-1)).toEqual([1, 100, 30])
  const made = terms.length
  // Its tab shows again.
  boxed(drawer, '60x40')
  expect(veiled(drawer)).toBe(true)
  act(() => drawer.root.render(<TerminalPane id={1} props={{ present: true, name: 'drawer:1', active: true }} />))
  expect(veiled(drawer)).toBe(false)
  expect(veiled(pane)).toBe(true)
  expect(resizes.at(-1)).toEqual([1, 60, 40])
  expect(store.getState().owners[1].name).toBe('drawer:1')
  expect(terms.length).toBe(made)
  act(() => drawer.root.unmount())
  act(() => pane.root.unmount())
})

// terminal.css off disk, as the Nexus scene tests read their stylesheet.
type Fs = { readFileSync(path: string, encoding: string): string }

test('a view drawn larger than its box (at a bigger owner\'s size) is cut at the box', async () => {
  const pane = mount('100x30')
  expect(pane.host.querySelector('.pane-body')!.classList.contains('terminal-body')).toBe(true)
  const fs = (await import(/* @vite-ignore */ 'node:' + 'fs')) as unknown as Fs
  const css = fs.readFileSync('src/terminal/terminal.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  expect(css).toMatch(/\.terminal-body\s*\{[^}]*overflow:\s*hidden/)
  act(() => pane.root.unmount())
})
