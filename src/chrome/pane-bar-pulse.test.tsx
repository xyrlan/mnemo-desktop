import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: async () => null, Channel: class {} }))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))
const openRule = vi.fn(async () => {})
vi.mock('../pulse/open', () => ({ openRule: (...a: unknown[]) => openRule(...(a as [])) }))

import PaneBar from './PaneBar'
import { FLASH_MS } from './info'
import type { ChromeClient } from './client'
import { store } from '../layout/app-store'
import { missionStore } from '../mission/app-store'
import { snapshot } from '../mission/fixtures'
import { pulseStore } from '../pulse/app-store'
import type { PulseEvent } from '../pulse/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const git: ChromeClient = { repo: async () => 'mnemo-desktop', branch: async () => 'main' }
const ev = (over: Partial<PulseEvent> = {}): PulseEvent => ({ at: 1, kind: 'reflex', project: 'mnemo-desktop', agent: 'mnemo-desktop', slugs: ['run-tests'], ...over })
const push = (e: PulseEvent) => act(async () => pulseStore.getState().push(e))

let host: HTMLDivElement
let root: Root
const bar = () => host.querySelector<HTMLElement>('.pane-bar')!
const badge = () => host.querySelector<HTMLButtonElement>('.pane-bar-pulse')

beforeEach(async () => {
  vi.useFakeTimers()
  pulseStore.setState({ log: [], counts: {}, claims: [] })
  missionStore.setState({ snapshot })
  store.setState({ tabs: [], activeTab: '', panes: {} })
  store.getState().openView('editor', { root: '/Users/me/github/mnemo-desktop-wt-c-pulse' }, 'tab', 'notes.md')
  const id = store.getState().tabs[0].focused
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root.render(<PaneBar id={id} client={git} />))
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

test('a pulse from the pane repo flashes the rule for FLASH_MS and leaves a counter', async () => {
  expect(badge()).toBeNull()
  await push(ev({ project: 'mnemo', agent: 'mnemo' }))
  expect(badge()).toBeNull()

  await push(ev())
  expect(bar().classList).toContain('pane-bar-pulsing')
  expect(bar().querySelector('.pane-bar-glow')).not.toBeNull()
  expect(badge()!.textContent).toBe('↯ run-tests1')
  expect(badge()!.title).toBe('mnemo injected: run-tests (click to open in the vault)')

  // A second pulse restarts the flash and counts.
  await act(async () => vi.advanceTimersByTime(FLASH_MS - 500))
  await push(ev({ kind: 'enforce', tool: 'Bash', slugs: ['no-force-push'] }))
  expect(bar().classList).toContain('pulse-enforce')
  await act(async () => vi.advanceTimersByTime(FLASH_MS - 100))
  expect(badge()!.textContent).toBe('↯ no-force-push2')

  await act(async () => vi.advanceTimersByTime(200))
  expect(bar().classList).not.toContain('pane-bar-pulsing')
  expect(bar().querySelector('.pane-bar-glow')).toBeNull()
  expect(badge()!.textContent).toBe('↯ 2')
  expect(badge()!.title).toBe('2 mnemo events in this pane since launch')
})

test('clicking the badge opens the rule; after a briefing it opens the last rule that fired', async () => {
  await push(ev({ slugs: ['older-rule'], agent: 'shared' }))
  await push(ev({ kind: 'tool', tool: 'session_start.inject', slugs: [] }))
  expect(badge()!.textContent).toBe('↯ session_start.inject2')
  const focused = store.getState().tabs[0].focused
  await act(async () => badge()!.click())
  expect(openRule).toHaveBeenLastCalledWith('older-rule', 'shared')

  await push(ev({ kind: 'enrich', slugs: ['fresh'] }))
  await act(async () => badge()!.click())
  expect(openRule).toHaveBeenLastCalledWith('fresh', 'mnemo-desktop')
  expect(store.getState().tabs[0].focused).toBe(focused)
})

test('a bar mounted again does not flash an old pulse, but keeps its count', async () => {
  await push(ev())
  act(() => root.unmount())
  await act(async () => vi.advanceTimersByTime(FLASH_MS + 1))
  root = createRoot(host)
  await act(async () => root.render(<PaneBar id={store.getState().tabs[0].focused} client={git} />))
  expect(bar().classList).not.toContain('pane-bar-pulsing')
  expect(badge()!.textContent).toBe('↯ 1')
})

test('a pulse from the pane repo also plays the overlay scene', async () => {
  await push(ev({ kind: 'learned' }))
  expect(host.querySelector('.pv-caption')?.textContent).toBe('learned something')
})

test('a pulse from another repo plays no overlay', async () => {
  await push(ev({ project: 'clubinho', agent: 'clubinho' }))
  expect(host.querySelector('.pv-overlay')).toBeNull()
})

test('two panes on one repo: each flashes and counts its own session, a sessionless pulse lands in one', async () => {
  const first = store.getState().tabs[0].focused
  store.getState().openView('editor', { root: '/Users/me/github/mnemo-desktop-wt-c-pulse' }, 'split-row', 'other.md')
  const second = store.getState().tabs[0].focused
  expect(second).not.toBe(first)
  store.getState().setSessionId(first, 'sa')
  store.getState().setSessionId(second, 'sb')
  const other = document.createElement('div')
  document.body.appendChild(other)
  const otherRoot = createRoot(other)
  await act(async () => otherRoot.render(<PaneBar id={second} client={git} />))
  const badgeOf = (h: HTMLElement) => h.querySelector('.pane-bar-pulse')?.textContent ?? null
  const scene = (h: HTMLElement) => h.querySelector('.pv-overlay') !== null

  await push(ev({ session_id: 'sa', slugs: ['for-a'] }))
  expect([badgeOf(host), badgeOf(other)]).toEqual(['↯ for-a1', null])
  expect([scene(host), scene(other)]).toEqual([true, false])

  await act(async () => vi.advanceTimersByTime(FLASH_MS + 1))
  await push(ev({ session_id: 'sb', slugs: ['for-b'] }))
  expect([badgeOf(host), badgeOf(other)]).toEqual(['↯ 1', '↯ for-b1'])

  // No session: the focused pane (the second) takes it, and only it.
  await act(async () => vi.advanceTimersByTime(FLASH_MS + 1))
  await push(ev({ kind: 'learned', slugs: ['learnt'] }))
  expect([badgeOf(host), badgeOf(other)]).toEqual(['↯ 1', '↯ learnt2'])
  expect([scene(host), scene(other)]).toEqual([false, true])

  act(() => otherRoot.unmount())
  other.remove()
  expect(pulseStore.getState().claims.map((c) => c.pane)).toEqual([first])
})
