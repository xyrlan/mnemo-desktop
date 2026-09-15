import { vi } from 'vitest'

const order: string[] = []
let handler: ((e: { payload: unknown }) => void) | undefined
const unlisten = vi.fn()
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (name: string, h: typeof handler) => {
    order.push(`listen ${name}`)
    handler = h
    return unlisten
  },
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: async (cmd: string) => void order.push(`invoke ${cmd}`) }))

import { tauriPulse } from './client'
import { connectPulse, pulseStore, recentFor, usePulse } from './app-store'
import { createPulseStore } from './store'

test('connect listens to mnemo://pulse before it starts the tail, and the store fills from it', async () => {
  const store = createPulseStore()
  const disconnect = await connectPulse(tauriPulse, store)
  expect(order).toEqual(['listen mnemo://pulse', 'invoke pulse_start'])
  handler!({ payload: { at: 1, kind: 'tool', project: 'p', agent: 'p', slugs: [], tool: 'read_mnemo_rule' } })
  expect(store.getState().recentFor('p')).toEqual([{ at: 1, kind: 'tool', project: 'p', agent: 'p', slugs: [], tool: 'read_mnemo_rule' }])
  disconnect()
  expect(unlisten).toHaveBeenCalled()
})

test('the app store exports the live store, a hook and recentFor', () => {
  expect(typeof usePulse).toBe('function')
  pulseStore.getState().push({ at: 1, kind: 'enrich', project: 'q', agent: 'q', slugs: ['s'] })
  expect(recentFor('q').map((e) => e.kind)).toEqual(['enrich'])
})
