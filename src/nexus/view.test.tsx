import type { ComponentType } from 'react'
import { all, run } from '../actions/registry'
import { nexusStore } from './store'
import './view'

// The view wires the app's live stores; the test records where it mounts.
const mounted = vi.hoisted((): Array<[string, ComponentType]> => [])
vi.mock('../dashboard/shell', () => ({
  mountInSlot: (slot: string, c: ComponentType) => {
    mounted.push([slot, c])
    return () => {}
  },
  useLeftEdge: () => 0,
}))

test('the Nexus mounts itself once, in the shell’s overlay slot', () => {
  expect(mounted.map(([slot]) => slot)).toEqual(['overlay'])
})

test('the app opens on the Nexus, and `nexus.toggle` closes and opens it', () => {
  expect(all().filter((a) => a.id === 'nexus.toggle')).toHaveLength(1)
  expect(all().find((a) => a.id === 'nexus.toggle')!.title).toBe('Nexus')
  expect(nexusStore.getState().open).toBe(true)
  run('nexus.toggle')
  expect(nexusStore.getState().open).toBe(false)
  run('nexus.toggle')
  expect(nexusStore.getState().open).toBe(true)
})
