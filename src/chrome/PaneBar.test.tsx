import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: async () => null, Channel: class {} }))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))

import PaneBar from './PaneBar'
import { dragStore } from './drag'
import type { ChromeClient } from './client'
import { store } from '../layout/app-store'
import { missionStore } from '../mission/app-store'
import { snapshot } from '../mission/fixtures'
import { pulseStore } from '../pulse/app-store'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const git: ChromeClient = { repo: async () => 'mnemo-desktop', branch: async () => 'main' }

let host: HTMLDivElement
let root: Root
let id: number
let other: number

beforeEach(async () => {
  pulseStore.setState({ log: [], counts: {}, claims: [] })
  missionStore.setState({ snapshot })
  store.setState({ tabs: [], activeTab: '', panes: {} })
  store.getState().openView('editor', { root: '/Users/me/github/mnemo-desktop' }, 'tab', 'notes.md')
  id = store.getState().tabs[0].focused!
  other = id + 1
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root.render(<PaneBar id={id} client={git} />))
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  dragStore.setState({ from: null, over: null, zone: null })
})

test('no drop-zone overlay while nothing is being dragged over this pane', () => {
  expect(host.querySelector('.pane-drop-zone')).toBeNull()
})

test('an edge zone over this pane draws the matching half', async () => {
  await act(async () => dragStore.setState({ from: other, over: id, zone: 'left' }))
  expect(host.querySelector('.pane-drop-zone.zone-left')).not.toBeNull()

  await act(async () => dragStore.setState({ zone: 'down' }))
  expect(host.querySelector('.pane-drop-zone.zone-left')).toBeNull()
  expect(host.querySelector('.pane-drop-zone.zone-down')).not.toBeNull()
})

test('the center zone covers the whole pane and says the two swap', async () => {
  await act(async () => dragStore.setState({ from: other, over: id, zone: 'center' }))
  const zone = host.querySelector('.pane-drop-zone.zone-center')
  expect(zone).not.toBeNull()
  expect(zone?.textContent).toBe('Swap')
})

test('no overlay without a drag, even with a stale target', async () => {
  await act(async () => dragStore.setState({ from: null, over: id, zone: 'left' }))
  expect(host.querySelector('.pane-drop-zone')).toBeNull()
})

test('the bar is new chrome: marked for the new tokens, closed by an X with a name', () => {
  const bar = host.querySelector('.pane-bar')!
  expect(bar.hasAttribute('data-ui')).toBe(true)
  expect(bar.querySelector('.pane-close')?.getAttribute('aria-label')).toBe('Close pane')
  expect(bar.querySelector('.pane-close svg')).not.toBeNull()
})

test('a zone over a different pane draws nothing here', async () => {
  await act(async () => dragStore.setState({ from: other, over: other, zone: 'left' }))
  expect(host.querySelector('.pane-drop-zone')).toBeNull()
})

describe('dropping the bar on another pane', () => {
  let beside: number
  let target: HTMLDivElement

  beforeEach(() => {
    store.getState().openView('editor', { root: '/tmp' }, 'split-row', 'other.md')
    beside = store.getState().tabs[0].focused
    store.getState().focusPane(id)
    host.className = 'pane'
    host.dataset.pane = String(id)
    target = document.createElement('div')
    target.className = 'pane'
    target.dataset.pane = String(beside)
    document.body.appendChild(target)
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 100, y: 0, width: 100, height: 100 }))
  })
  afterEach(() => target.remove())

  const drag = (to: Element, x: number, y: number) => {
    const bar = host.querySelector('.pane-bar')!
    const at = (type: string, el: Element, cx: number, cy: number) =>
      el.dispatchEvent(new MouseEvent(type, { clientX: cx, clientY: cy, bubbles: true, cancelable: true, button: 0 }))
    at('mousedown', bar, 0, 0)
    at('mousemove', to, x, y)
    at('mouseup', to, x, y)
  }
  const tree = () => store.getState().tabs[0].root

  test("an edge moves this pane to that side of the other and keeps it focused", () => {
    expect(tree()).toEqual({ kind: 'split', dir: 'row', ratio: 0.5, children: [{ kind: 'leaf', pane: id }, { kind: 'leaf', pane: beside }] })
    drag(target, 150, 95)
    expect(tree()).toEqual({ kind: 'split', dir: 'col', ratio: 0.5, children: [{ kind: 'leaf', pane: beside }, { kind: 'leaf', pane: id }] })
    expect(store.getState().tabs[0].focused).toBe(id)
  })

  test('the center still swaps the two', () => {
    drag(target, 150, 50)
    expect(tree()).toEqual({ kind: 'split', dir: 'row', ratio: 0.5, children: [{ kind: 'leaf', pane: beside }, { kind: 'leaf', pane: id }] })
  })

  test('its own bar leaves the tree as it was', () => {
    const before = tree()
    drag(host.querySelector('.pane-bar')!, 90, 50)
    expect(tree()).toBe(before)
  })
})
