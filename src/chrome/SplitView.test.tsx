import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'

const git: Record<string, string | null> = { chrome_repo: 'mnemo-desktop', chrome_branch: 'feat/round5/chrome' }
const invoke = vi.fn(async (cmd: string, _args?: unknown) => git[cmd] ?? null)
vi.mock('@tauri-apps/api/core', () => ({ invoke: (cmd: string, args: unknown) => invoke(cmd, args), Channel: class {} }))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))

import { store } from '../layout/app-store'
import SplitView from '../layout/SplitView'
import { leaves } from '../layout/tree'
import { registerPaneView, type PaneViewProps } from '../panes/registry'
import { missionStore } from '../mission/app-store'
import { snapshot } from '../mission/fixtures'
import { THRESHOLD } from './drag'
import { fileDropStore } from '../terminal/drop'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mounts: number[] = []
function Probe({ id }: PaneViewProps) {
  useEffect(() => {
    mounts.push(id)
  }, [id])
  return <input className="probe" data-probe={id} />
}
registerPaneView('probe', Probe)

let host: HTMLDivElement
let root: Root
/** Left probe, right editor, bottom-right probe (ids differ per test: the store is shared). */
let A: number, B: number, C: number

beforeEach(async () => {
  mounts.length = 0
  invoke.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  missionStore.setState({ snapshot })
  store.setState({ tabs: [], activeTab: '', panes: {} })
  store.getState().openView('probe', {}, 'tab', 'left')
  store.getState().openView('editor', { root: '/Users/me/github/mnemo-desktop' }, 'split-row', 'notes.md')
  store.getState().openView('probe', {}, 'split-col', 'bottom')
  ;[A, B, C] = leaves(tab().root)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const tab = () => store.getState().tabs.find((t) => t.id === store.getState().activeTab)!
const pane = (id: number) => host.querySelector<HTMLElement>(`.pane[data-pane="${id}"]`)!
async function render() {
  await act(async () => root.render(<SplitView node={tab().root} />))
}
const mouse = (type: string, target: Element, x: number) =>
  act(() => void target.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: 0, bubbles: true, cancelable: true, button: 0 })))

test('every pane gets a bar above its view, and a divider per split', async () => {
  await render()
  const ids = [...host.querySelectorAll<HTMLElement>('.pane')].map((p) => Number(p.dataset.pane))
  expect(ids.sort()).toEqual([A, B, C].sort())
  for (const id of ids) expect(pane(id).firstElementChild?.classList.contains('pane-bar')).toBe(true)
  expect(host.querySelectorAll('.divider')).toHaveLength(2)
  expect(pane(A).querySelector('.pane-close')).not.toBeNull()
})

test('the bar shows repo and branch from git for a pane with a cwd', async () => {
  await render()
  const bar = pane(B).querySelector('.pane-bar')!
  expect(invoke).toHaveBeenCalledWith('chrome_branch', { cwd: '/Users/me/github/mnemo-desktop' })
  expect(bar.querySelector('.pane-bar-repo')?.textContent).toBe('mnemo-desktop')
  expect(bar.querySelector('.pane-bar-branch')?.textContent).toBe('feat/round5/chrome')
  expect(bar.querySelector('.pane-bar-title')?.textContent).toBe('notes.md')
  expect(pane(A).querySelector('.pane-bar-branch')).toBeNull()
})

test('swapping panes moves their boxes without remounting their views', async () => {
  await render()
  const before = { a: pane(A), c: pane(C), probe: pane(A).querySelector('.probe') }
  const leftBox = pane(A).style.cssText
  expect(mounts.sort()).toEqual([A, C].sort())
  await act(async () => store.getState().swapPanes(A, C))
  await render()
  expect(pane(A)).toBe(before.a)
  expect(pane(C)).toBe(before.c)
  expect(pane(A).querySelector('.probe')).toBe(before.probe)
  expect(pane(C).style.cssText).toBe(leftBox)
  expect(mounts.sort()).toEqual([A, C].sort())
})

test('dragging a bar onto another pane highlights the target and swaps on release', async () => {
  await render()
  const bar = pane(A).querySelector('.pane-bar')!
  await mouse('mousedown', bar, 0)
  await mouse('mousemove', pane(B).querySelector('.pane-content')!, THRESHOLD + 10)
  expect(pane(B).classList.contains('drop-target')).toBe(true)
  expect(pane(A).classList.contains('drag-source')).toBe(true)
  await mouse('mouseup', pane(B).querySelector('.pane-content')!, THRESHOLD + 10)
  expect(tab().root).toMatchObject({ children: [{ kind: 'leaf', pane: B }, { children: [{ pane: A }, { pane: C }] }] })
  await render()
  expect(pane(B).classList.contains('drop-target')).toBe(false)
})

test('pressing the bar focuses its pane but does not steal keyboard focus from inside it', async () => {
  await render()
  const own = pane(C).querySelector<HTMLInputElement>('.probe')!
  own.focus()
  await mouse('mousedown', pane(C).querySelector('.pane-bar-title')!, 0)
  await mouse('mouseup', pane(C).querySelector('.pane-bar-title')!, 0)
  expect(tab().focused).toBe(C)
  expect(document.activeElement).toBe(own)

  // Focus sitting in another pane is released, so it cannot keep receiving keys.
  await mouse('mousedown', pane(A).querySelector('.pane-bar')!, 0)
  await mouse('mouseup', pane(A).querySelector('.pane-bar')!, 0)
  expect(tab().focused).toBe(A)
  expect(document.activeElement).not.toBe(own)
})

test('a pane bar dragged over another pane marks it as a pane drop, not a file drop', async () => {
  await render()
  await mouse('mousedown', pane(A).querySelector('.pane-bar')!, 0)
  await mouse('mousemove', pane(B).querySelector('.pane-content')!, THRESHOLD + 10)
  expect(pane(B).classList.contains('pane-drop')).toBe(true)
  expect(pane(C).classList.contains('pane-drop')).toBe(false)
  await act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
  expect(pane(B).classList.contains('pane-drop')).toBe(false)
})

test('a file dragged from Finder over a pane highlights it whole, as no pane drop', async () => {
  await render()
  await act(async () => fileDropStore.setState({ over: B }))
  expect(pane(B).classList.contains('drop-target')).toBe(true)
  expect(pane(B).classList.contains('pane-drop')).toBe(false)
  await act(async () => fileDropStore.setState({ over: null }))
})

test('only a tab of several panes is a split, whose unfocused panes dim', async () => {
  await render()
  expect(host.querySelector('.split-root')!.classList.contains('is-split')).toBe(true)
  await act(async () => root.render(<SplitView node={{ kind: 'leaf', pane: A }} />))
  expect(host.querySelector('.split-root')!.classList.contains('is-split')).toBe(false)
})

describe('the resize handle', () => {
  const pointer = (type: string, target: EventTarget, x: number, y = 0) =>
    act(() => void target.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0 })))
  const box = (w: number, h: number) =>
    vi.spyOn(host.querySelector('.split-root')!, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 0, y: 0, width: w, height: h }))

  test('a line on a grab strip, oriented across its split', async () => {
    await render()
    const [row, col] = [host.querySelector('.divider.row')!, host.querySelector('.divider.col')!]
    expect(row.classList.contains('is-vertical')).toBe(true)
    expect(col.classList.contains('is-horizontal')).toBe(true)
    expect(row.getAttribute('role')).toBe('separator')
  })

  test('dragging it resizes the split, held between 15% and 85%', async () => {
    await render()
    box(1000, 600)
    const handle = host.querySelector('.divider.row')!
    await pointer('pointerdown', handle, 500)
    expect(handle.classList.contains('is-dragging')).toBe(true)
    await pointer('pointermove', window, 300)
    expect((tab().root as { ratio: number }).ratio).toBeCloseTo(0.3)
    await pointer('pointermove', window, 20)
    expect((tab().root as { ratio: number }).ratio).toBe(0.15)
    await pointer('pointermove', window, 990)
    expect((tab().root as { ratio: number }).ratio).toBe(0.85)
    await pointer('pointerup', window, 990)
    expect(handle.classList.contains('is-dragging')).toBe(false)
    await pointer('pointermove', window, 500)
    expect((tab().root as { ratio: number }).ratio).toBe(0.85)
  })
})

test('the close button in the bar closes that pane', async () => {
  await render()
  await act(async () => void pane(B).querySelector<HTMLButtonElement>('.pane-close')!.click())
  expect(store.getState().panes[B]).toBeUndefined()
  expect(tab().focused).not.toBe(B)
})
