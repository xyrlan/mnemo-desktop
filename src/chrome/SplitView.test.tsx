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

test('the close button in the bar closes that pane', async () => {
  await render()
  await act(async () => void pane(B).querySelector<HTMLButtonElement>('.pane-close')!.click())
  expect(store.getState().panes[B]).toBeUndefined()
  expect(tab().focused).not.toBe(B)
})
