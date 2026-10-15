import { act, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { all } from '../actions/registry'
import './view'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// The view wires the app's live stores; the test records where it mounts, and what it starts.
const mounted = vi.hoisted((): Array<[string, ComponentType]> => [])
const started = vi.hoisted(() => ({ starts: 0, stops: 0 }))
vi.mock('../shell/slots', () => ({
  mountInSlot: (slot: string, c: ComponentType) => {
    mounted.push([slot, c])
    return () => {}
  },
}))
vi.mock('./boot', () => ({
  startNexusApp: () => {
    started.starts++
    return () => void started.stops++
  },
}))
vi.mock('./NexusView', () => ({ NexusView: () => null }))

test('the Nexus mounts itself once, in the shell’s overlay slot', () => {
  expect(mounted.map(([slot]) => slot)).toEqual(['overlay'])
})

test('it is always shown: no action opens or closes it (#459)', () => {
  expect(all().map((a) => a.id)).not.toContain('nexus.toggle')
  expect(all().map((a) => a.id)).not.toContain('nexus.triage')
})

test('mounted, it starts the app (settings, toaster, first run); unmounted, it stops it', async () => {
  const Nexus = mounted[0][1]
  const host = document.createElement('div')
  const root = createRoot(host)
  await act(async () => root.render(<Nexus />))
  expect(started).toEqual({ starts: 1, stops: 0 })
  await act(async () => root.unmount())
  expect(started).toEqual({ starts: 1, stops: 1 })
})
