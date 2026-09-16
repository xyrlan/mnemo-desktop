import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { vi } from 'vitest'
import Overlay, { OVERLAY_MS } from './Overlay'
import { createPulseStore } from './store'
import { SCENES } from '../avatar/scenes'
import type { PulseEvent } from './types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const ev = (over: Partial<PulseEvent> = {}): PulseEvent => ({ at: 1, kind: 'reflex', project: 'mnemo-desktop', agent: 'mnemo-desktop', slugs: [], ...over })

afterEach(() => vi.useRealTimers())

/** A store where pane 1 shows mnemo-desktop. */
const storeWithPane = () => {
  const store = createPulseStore()
  store.getState().claim({ pane: 1, place: 'mnemo-desktop' })
  return store
}

test('an event from the pane repo plays, and clears itself after OVERLAY_MS', async () => {
  vi.useFakeTimers()
  const store = storeWithPane()
  const host = document.createElement('div')
  const root = createRoot(host)
  await act(async () => root.render(<Overlay pane={1} store={store} />))
  expect(host.querySelector('.pv-overlay')).toBeNull()

  await act(async () => store.getState().push(ev({ hits: 2 })))
  expect(host.querySelector('.pv-caption')?.textContent).toBe('injecting 2 rules')
  expect(host.querySelector('.av-injecting')).not.toBeNull()

  await act(async () => vi.advanceTimersByTime(OVERLAY_MS - 10))
  expect(host.querySelector('.pv-overlay')).not.toBeNull()
  await act(async () => vi.advanceTimersByTime(20))
  expect(host.querySelector('.pv-overlay')).toBeNull()
  act(() => root.unmount())
})

test('an event from another repo never appears', async () => {
  const store = storeWithPane()
  const host = document.createElement('div')
  const root = createRoot(host)
  await act(async () => root.render(<Overlay pane={1} store={store} />))
  await act(async () => store.getState().push(ev({ project: 'clubinho', agent: 'clubinho' })))
  expect(host.querySelector('.pv-overlay')).toBeNull()
  act(() => root.unmount())
})

test('a second event replaces the first rather than stacking', async () => {
  vi.useFakeTimers()
  const store = storeWithPane()
  const host = document.createElement('div')
  const root = createRoot(host)
  await act(async () => root.render(<Overlay pane={1} store={store} />))

  await act(async () => store.getState().push(ev({ kind: 'reflex', hits: 1 })))
  await act(async () => vi.advanceTimersByTime(OVERLAY_MS / 2))
  await act(async () => store.getState().push(ev({ kind: 'learned' })))

  expect(host.querySelectorAll('.pv-overlay')).toHaveLength(1)
  expect(host.querySelector('.pv-caption')?.textContent).toBe('learned something')
  // The replacement gets a full turn, not the remainder of the first.
  await act(async () => vi.advanceTimersByTime(OVERLAY_MS - 10))
  expect(host.querySelector('.pv-overlay')).not.toBeNull()
  act(() => root.unmount())
})

test('a kind with minIntervalMs skips events inside its gap, and plays again after it', async () => {
  vi.useFakeTimers()
  const store = storeWithPane()
  const host = document.createElement('div')
  const root = createRoot(host)
  // The dial ships at 0 for every kind; this proves it works when turned up.
  const shipped = SCENES.tool.minIntervalMs
  SCENES.tool.minIntervalMs = 10_000
  await act(async () => root.render(<Overlay pane={1} store={store} />))

  await act(async () => store.getState().push(ev({ kind: 'tool' })))
  expect(host.querySelector('.pv-caption')?.textContent).toBe('reading memory')
  await act(async () => vi.advanceTimersByTime(OVERLAY_MS + 10))

  await act(async () => store.getState().push(ev({ kind: 'tool' })))
  expect(host.querySelector('.pv-overlay'), 'inside the gap, it is skipped').toBeNull()

  // A different kind is unaffected by tool's gap.
  await act(async () => store.getState().push(ev({ kind: 'learned' })))
  expect(host.querySelector('.pv-caption')?.textContent).toBe('learned something')
  SCENES.tool.minIntervalMs = shipped
  act(() => root.unmount())
})

test('a pane that claimed nothing shows nothing', async () => {
  const store = storeWithPane()
  const host = document.createElement('div')
  const root = createRoot(host)
  await act(async () => root.render(<Overlay pane={2} store={store} />))
  await act(async () => store.getState().push(ev()))
  expect(host.querySelector('.pv-overlay')).toBeNull()
  act(() => root.unmount())
})

test('two panes on one repo: a session event plays in its own pane, a sessionless one in exactly one', async () => {
  const store = createPulseStore()
  store.getState().claim({ pane: 1, place: 'mnemo-desktop', sessionId: 'sa' })
  store.getState().claim({ pane: 2, place: 'mnemo-desktop', sessionId: 'sb' })
  const hosts = [document.createElement('div'), document.createElement('div')]
  const roots = hosts.map((h) => createRoot(h))
  await act(async () => roots.forEach((r, i) => r.render(<Overlay pane={i + 1} store={store} />)))
  const playing = () => hosts.map((h) => h.querySelector('.pv-overlay') !== null)

  await act(async () => store.getState().push(ev({ session_id: 'sb', hits: 1 })))
  expect(playing()).toEqual([false, true])

  await act(async () => store.getState().push(ev({ kind: 'learned' })))
  expect(playing()).toEqual([true, true])
  expect(hosts.map((h) => h.querySelector('.pv-caption')?.textContent)).toEqual(['learned something', 'injecting 1 rule'])
  roots.forEach((r) => act(() => r.unmount()))
})

test('it announces politely and never eats a click meant for the terminal', async () => {
  const store = storeWithPane()
  const host = document.createElement('div')
  const root = createRoot(host)
  await act(async () => root.render(<Overlay pane={1} store={store} />))
  await act(async () => store.getState().push(ev()))
  const el = host.querySelector('.pv-overlay')!
  expect(el.getAttribute('aria-live')).toBe('polite')
  expect(el.getAttribute('role')).toBe('status')
  act(() => root.unmount())
})
