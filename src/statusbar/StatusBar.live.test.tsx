import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { vi } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// A real zustand store behind `useApp`, unlike StatusBar.test.tsx's plain object: a selector that
// returns a new object on every read loops only when React subscribes to a store. The status bar
// did exactly that once a pane was focused, and crashed with "Maximum update depth exceeded".
vi.mock('../layout/app-store', async () => {
  const { createStore, useStore } = await import('zustand')
  const store = createStore(() => ({ tabs: [{ id: 't', root: { kind: 'leaf', pane: 1 }, focused: 1 }], activeTab: 't', panes: { 1: { id: 1, view: 'terminal', cwd: '/a' } } }))
  return { store, useApp: (sel: (s: unknown) => unknown) => useStore(store, sel) }
})
vi.mock('../fleet/store', () => ({ useFleet: (sel: (f: unknown) => unknown) => sel({ repos: [] }) }))
vi.mock('../mission/app-store', () => ({ useMission: (sel: (s: unknown) => unknown) => sel({ snapshot: { repos: [] } }) }))
vi.mock('../pulse/app-store', () => ({ usePulse: (sel: (s: unknown) => unknown) => sel({ counts: {} }) }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import StatusBar from './StatusBar'

const client = { level: async () => ({ error: 'no vault' }) as never, best: async (xp: number) => xp }

test('renders with a focused pane in a live store, without looping', async () => {
  const host = document.createElement('div')
  const errors: unknown[] = []
  const spy = vi.spyOn(console, 'error').mockImplementation((...a) => void errors.push(a))
  await act(async () => {
    createRoot(host).render(<StatusBar client={client} />)
  })
  spy.mockRestore()
  expect(host.querySelector('[role="status"]')).not.toBeNull()
  expect(errors.filter((e) => String(e).includes('Maximum update depth'))).toEqual([])
})
