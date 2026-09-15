import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { vi } from 'vitest'

const openRule = vi.fn(async () => {})
vi.mock('./open', () => ({ openRule: (...a: unknown[]) => openRule(...(a as [])) }))

import Toasts, { TOAST_MS } from './Toasts'
import { createPulseStore } from './store'
import type { PulseEvent } from './types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const ev = (over: Partial<PulseEvent>): PulseEvent => ({ at: 1, kind: 'reflex', project: 'mnemo-desktop', agent: 'mnemo-desktop', slugs: ['x'], ...over })

afterEach(() => vi.useRealTimers())

test('only enforce pulses toast; each goes after TOAST_MS even when other pulses follow; click opens the rule', async () => {
  vi.useFakeTimers()
  const store = createPulseStore()
  store.getState().push(ev({ kind: 'enforce', slugs: ['old'] }))
  const host = document.createElement('div')
  const root = createRoot(host)
  await act(async () => root.render(<Toasts store={store} />))
  expect(host.querySelector('.pulse-toast')).toBeNull()

  await act(async () => store.getState().push(ev({ kind: 'tool', slugs: [] })))
  expect(host.querySelector('.pulse-toast')).toBeNull()

  await act(async () => store.getState().push(ev({ kind: 'enforce', tool: 'Bash', slugs: ['never-force-push-main'] })))
  expect(host.querySelector('.pulse-toast')?.textContent).toBe('⛔ mnemo blocked Bashnever-force-push-main · mnemo-desktop')
  await act(async () => store.getState().push(ev({ kind: 'reflex' })))
  await act(async () => vi.advanceTimersByTime(TOAST_MS - 10))
  expect(host.querySelectorAll('.pulse-toast')).toHaveLength(1)
  await act(async () => vi.advanceTimersByTime(20))
  expect(host.querySelector('.pulse-toast')).toBeNull()

  await act(async () => store.getState().push(ev({ kind: 'enforce', project: 'mnemo', agent: 'mnemo', slugs: ['rule'] })))
  await act(async () => (host.querySelector('.pulse-toast') as HTMLElement).click())
  expect(openRule).toHaveBeenCalledWith('rule', 'mnemo')
  expect(host.querySelector('.pulse-toast')).toBeNull()
  act(() => root.unmount())
})
