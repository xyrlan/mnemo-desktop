import { act } from 'react'
import type { RepoNode } from '../fleet/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = RO
Element.prototype.scrollIntoView ??= function () {}

// The live fleet and layout stores reach Tauri; the palette only reads them.
const switched: string[] = []
vi.mock('../fleet/store', async () => {
  const { createStore, useStore } = await import('zustand')
  const repos: RepoNode[] = [
    { root: '/code/app', name: 'app', worktrees: [{ path: '/code/app', name: 'app', branch: 'main', kind: 'main', agents: [], pr: null, unread: false }] },
    { root: '/code/site', name: 'site', worktrees: [{ path: '/code/site', name: 'site', branch: 'main', kind: 'main', agents: [], pr: null, unread: false }] },
  ]
  const fleetStore = createStore(() => ({ repos, markRead() {}, async refresh() {} }))
  return { fleetStore, useFleet: (sel: (f: unknown) => unknown) => useStore(fleetStore, sel) }
})
vi.mock('../layout/app-store', async () => {
  const { createStore, useStore } = await import('zustand')
  const store = createStore(() => ({ activeWorktree: '/code/app', switchWorktree: async (p: string) => void switched.push(p) }))
  return { store, useApp: (sel: (s: unknown) => unknown) => useStore(store, sel) }
})

import { all, run } from '../actions/registry'
import { jumpStore } from './store'

// Cold, the import transforms Radix and cmdk: slower than the default hook timeout on CI.
beforeAll(async () => {
  await act(async () => {
    await import('./view')
  })
}, 60_000)

const input = () => document.querySelector<HTMLInputElement>('[cmdk-input]')

it('registers worktree.jump, which toggles the palette', async () => {
  expect(all().filter((a) => a.id === 'worktree.jump')).toHaveLength(1)
  expect(input()).toBeNull()
  await act(async () => run('worktree.jump'))
  expect(jumpStore.getState().open).toBe(true)
  expect(input()).not.toBeNull()
  expect([...document.querySelectorAll('[cmdk-item]')].map((r) => r.getAttribute('data-value'))).toEqual(['/code/app', '/code/site'])
  await act(async () => run('worktree.jump'))
  expect(jumpStore.getState().open).toBe(false)
})

it('switches to the worktree picked, and closes', async () => {
  await act(async () => run('worktree.jump'))
  await act(async () => input()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
  await act(async () => input()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  expect(switched).toEqual(['/code/site'])
  expect(jumpStore.getState().open).toBe(false)
})
