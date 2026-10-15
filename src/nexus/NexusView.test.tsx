import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { NexusClient } from './client'
import { NexusView } from './NexusView'
import type { ShipClient } from './ship-client'
import { nexusStore } from './store'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const usage: NexusClient = { archives: async () => ({ projects: {}, universal: 0 }), logUsage: async () => {} }
const fake = () => {
  const c = {
    asked: 0,
    feed: async () => {
      c.asked++
      return { sessions: {}, prs: {}, rate: null, at: 1 }
    },
  }
  return c satisfies ShipClient
}
const view = () => document.querySelector('[data-nexus-view]')

afterEach(() => {
  nexusStore.getState().setOpen(true)
  document.body.innerHTML = ''
})

test('open, it covers the workbench from the sidebar’s edge and reads the feed', async () => {
  const client = fake()
  const host = document.body.appendChild(document.createElement('div'))
  await act(async () => createRoot(host).render(<NexusView client={client} usage={usage} leftEdge={52} />))
  expect(view()).not.toBeNull()
  expect((view() as HTMLElement).style.left).toBe('52px')
  expect(client.asked).toBeGreaterThan(0)
  expect(document.querySelector('[data-ship-scene]')).not.toBeNull()
})

test('closed, it reads nothing and draws nothing', async () => {
  nexusStore.getState().setOpen(false)
  const client = fake()
  const host = document.body.appendChild(document.createElement('div'))
  await act(async () => createRoot(host).render(<NexusView client={client} usage={usage} leftEdge={0} />))
  expect(view()).toBeNull()
  expect(client.asked).toBe(0)
})
