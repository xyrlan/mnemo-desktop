import type { ComponentType } from 'react'
import { all, run } from '../actions/registry'
import { dashboardStore } from './store'
import './view'

// The view wires the app's live stores; the test gives it inert ones and records where it mounts.
const mounted = vi.hoisted((): Array<[string, ComponentType]> => [])
vi.mock('./shell', () => ({
  mountInSlot: (slot: string, c: ComponentType) => {
    mounted.push([slot, c])
    return () => {}
  },
  useLeftEdge: () => 0,
}))
vi.mock('../fleet/store', async () => {
  const { createStore } = await import('zustand/vanilla')
  return { fleetStore: createStore(() => ({ repos: [], markRead() {}, async refresh() {} })) }
})
vi.mock('../layout/app-store', async () => {
  const { createStore } = await import('zustand/vanilla')
  return { store: createStore(() => ({ async switchWorktree() {}, goToPane() {} })) }
})

test('the dashboard mounts itself once, in the shell’s overlay slot', () => {
  expect(mounted.map(([slot]) => slot)).toEqual(['overlay'])
})

test('`dashboard.toggle` opens and closes the drawer', () => {
  expect(all().filter((a) => a.id === 'dashboard.toggle')).toHaveLength(1)
  expect(all().find((a) => a.id === 'dashboard.toggle')!.title).toBe('Agent dashboard')
  expect(dashboardStore.getState().open).toBe(false)
  run('dashboard.toggle')
  expect(dashboardStore.getState().open).toBe(true)
  run('dashboard.toggle')
  expect(dashboardStore.getState().open).toBe(false)
})
