import type { ComponentType } from 'react'
import { all, run } from '../actions/registry'
import { nexusStore } from './store'
import './view'

// The view wires the app's live stores; the test records where it mounts.
const mounted = vi.hoisted((): Array<[string, ComponentType]> => [])
vi.mock('../shell/slots', () => ({
  mountInSlot: (slot: string, c: ComponentType) => {
    mounted.push([slot, c])
    return () => {}
  },
}))
vi.mock('../shell/edges', () => ({ useLeftEdge: () => 0 }))

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

test('`nexus.triage` opens the Nexus and asks the view for triage, from closed or open', () => {
  expect(all().filter((a) => a.id === 'nexus.triage')).toHaveLength(1)
  nexusStore.setState({ open: false, triage: false, triageAsked: false })
  run('nexus.triage')
  // Triage itself is the view's call: it knows whether a robot waits (NexusView.test).
  expect(nexusStore.getState()).toMatchObject({ open: true, triage: false, triageAsked: true })
  nexusStore.setState({ triageAsked: false })
  run('nexus.triage')
  expect(nexusStore.getState()).toMatchObject({ open: true, triageAsked: true })
})
