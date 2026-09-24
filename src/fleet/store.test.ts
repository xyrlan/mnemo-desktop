import { describe, expect, it, vi } from 'vitest'
import type { StoreApi } from 'zustand/vanilla'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'

const ROOT = '/Users/me/github/app'

// The app's stores, as plain stores: `store.ts` must read them, and nothing else.
const fakes = vi.hoisted(() => ({}) as Record<string, unknown>)
vi.mock('../home/app-store', async () => {
  const { createStore } = await import('zustand/vanilla')
  const homeStore = createStore(() => ({
    snapshot: { repos: [{ root: '/Users/me/github/app', name: 'app', last_at: 0, pinned: false, hidden: false, unresolved: false, sessions: [], children: [] }], clone_base: '', errors: [], protected: 0 },
    load: vi.fn(async () => {}),
  }))
  fakes.home = homeStore
  return { homeStore }
})
vi.mock('../mission/app-store', async () => {
  const { createStore } = await import('zustand/vanilla')
  const missionStore = createStore(() => ({ snapshot: { repos: [], errors: [], at: '' }, refresh: vi.fn(async () => {}) }))
  fakes.mission = missionStore
  return { missionStore }
})
vi.mock('../layout/app-store', async () => {
  const { createStore } = await import('zustand/vanilla')
  return { store: createStore(() => ({ tabs: [], activeTab: null, panes: { 4: { id: 4, view: 'terminal', sessionId: 'a' } } })) }
})
vi.mock('./upstream', () => ({
  listWorktrees: vi.fn(async (root: string) => [{ path: root, branch: 'main', head: 'x', isMain: true, dispatched: false, dirty: false, setupJob: null }]),
  subscribeAgentEvents: vi.fn(() => () => {}),
}))

describe('the live fleet', () => {
  it('follows the app’s stores, and useFleet reads it', async () => {
    const { fleetStore, useFleet } = await import('./store')
    const mission = fakes.mission as StoreApi<{ snapshot: unknown; refresh: ReturnType<typeof vi.fn> }>
    await vi.waitFor(() => expect(fleetStore.getState().repos.map((r) => r.root)).toEqual([ROOT]))
    expect(mission.getState().refresh).toHaveBeenCalledWith(undefined, true)

    mission.setState({
      snapshot: { repos: [{ root: ROOT, name: 'app', parents: [{ session_id: 'a', pid: 1, name: 'fix it', status: 'busy', cwd: ROOT }], missions: [], children: [] }], errors: [], at: '1' },
    })
    let seen: unknown
    function Probe() {
      seen = useFleet((f) => f.repos[0]?.worktrees[0]?.agents)
      return null
    }
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const root = createRoot(document.createElement('div'))
    await act(async () => root.render(createElement(Probe)))
    expect(seen).toEqual([{ sessionId: 'a', paneId: 4, state: 'working', waitingFor: null, title: 'fix it', since: expect.any(Number) }])
    act(() => root.unmount())
  })
})
