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

test('an edge zone over this pane draws the matching strip', async () => {
  await act(async () => dragStore.setState({ from: other, over: id, zone: 'left' }))
  expect(host.querySelector('.pane-drop-zone.zone-left')).not.toBeNull()

  await act(async () => dragStore.setState({ zone: 'down' }))
  expect(host.querySelector('.pane-drop-zone.zone-left')).toBeNull()
  expect(host.querySelector('.pane-drop-zone.zone-down')).not.toBeNull()
})

test('the center zone draws no strip (the whole-pane highlight covers it)', async () => {
  await act(async () => dragStore.setState({ from: other, over: id, zone: 'center' }))
  expect(host.querySelector('.pane-drop-zone')).toBeNull()
})

test('a zone over a different pane draws nothing here', async () => {
  await act(async () => dragStore.setState({ from: other, over: other, zone: 'left' }))
  expect(host.querySelector('.pane-drop-zone')).toBeNull()
})
