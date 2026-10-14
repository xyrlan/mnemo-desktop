import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const calls: string[] = []
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string) => {
    calls.push(cmd)
    return { root: null, pages: 0, rules_fired: 0, fires: 0, fired_recent: 0, dormant: 0, label_only: 0, inbox: 0, error: 'no vault' }
  },
}))
vi.mock('../fleet/store', () => ({ useFleet: (sel: (f: unknown) => unknown) => sel({ repos: [] }) }))

import Pet from './Pet'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

test('the pet reads the vault level every 30 s while the window shows, not while it is hidden', async () => {
  vi.useFakeTimers()
  const state = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  const reads = () => calls.filter((c) => c === 'vault_level').length
  const root = createRoot(document.createElement('div'))
  await act(async () => root.render(<Pet />))
  expect(reads()).toBe(1)
  await act(async () => void (await vi.advanceTimersByTimeAsync(30_000)))
  expect(reads()).toBe(2)
  state.mockReturnValue('hidden')
  await act(async () => void (await vi.advanceTimersByTimeAsync(10 * 30_000)))
  expect(reads()).toBe(2)
  state.mockReturnValue('visible')
  await act(async () => void document.dispatchEvent(new Event('visibilitychange')))
  expect(reads()).toBe(3)
  act(() => root.unmount())
})
