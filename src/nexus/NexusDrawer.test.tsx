import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { NexusClient } from './client'
import { NexusDrawer } from './NexusDrawer'
import { nexusStore } from './store'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const fake = () => {
  const c = {
    asked: 0,
    archives: async () => {
      c.asked++
      return { projects: {}, universal: 0 }
    },
    logUsage: async () => {},
  }
  return c satisfies NexusClient
}

const sheet = () => document.querySelector('[data-nexus-sheet]')

// v1's drawer, kept until v2 lands; the store now opens on the Nexus, so each test starts closed.
beforeEach(() => nexusStore.getState().setOpen(false))

afterEach(async () => {
  await act(async () => nexusStore.getState().setOpen(false))
  document.body.innerHTML = ''
})

test('closed, the drawer asks for nothing and draws nothing', async () => {
  const client = fake()
  const host = document.body.appendChild(document.createElement('div'))
  await act(async () => createRoot(host).render(<NexusDrawer client={client} leftEdge={0} />))
  expect(client.asked).toBe(0)
  expect(sheet()).toBeNull()
})

test('open, it asks for the archives and draws the scene', async () => {
  const client = fake()
  const host = document.body.appendChild(document.createElement('div'))
  await act(async () => createRoot(host).render(<NexusDrawer client={client} leftEdge={0} />))
  await act(async () => nexusStore.getState().setOpen(true))
  expect(client.asked).toBe(1)
  expect(sheet()).not.toBeNull()
})
