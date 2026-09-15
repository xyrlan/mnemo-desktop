import { BORN_EVENT, CHANGED_EVENT, makeMapClient } from './client'
import { createMapStore } from './store'

test('the client calls the vaultmap commands with the contract arguments and listens to its events', async () => {
  const calls: [string, unknown][] = []
  const handlers = new Map<string, (e: { payload: unknown }) => void>()
  const unlisten = vi.fn()
  const client = makeMapClient(
    async <T,>(cmd: string, args?: Record<string, unknown>) => {
      calls.push([cmd, args])
      return (cmd === 'vault_map' ? { nodes: [], edges: [], error: null } : {}) as T
    },
    async (event, handler) => {
      handlers.set(event, handler as (e: { payload: unknown }) => void)
      return unlisten
    },
  )
  await client.map('agent:x')
  await client.positions('')
  await client.savePositions('', { '/a.md': [1, 2] })
  expect(calls).toEqual([
    ['vault_map', { scope: 'agent:x' }],
    ['vault_map_positions_read', { scope: '' }],
    ['vault_map_positions_write', { scope: '', positions: { '/a.md': [1, 2] } }],
  ])

  const born = vi.fn()
  const changed = vi.fn()
  const off = await client.onBorn(born)
  await client.onChanged(changed)
  expect(BORN_EVENT).toBe('mnemo://vault-born')
  handlers.get(BORN_EVENT)!({ payload: { path: '/v/shared/x.md', slug: 'x' } })
  handlers.get(CHANGED_EVENT)!({ payload: { paths: ['/v/a.md'] } })
  expect(born).toHaveBeenCalledWith({ path: '/v/shared/x.md', slug: 'x' })
  expect(changed).toHaveBeenCalledWith({ paths: ['/v/a.md'] })
  off()
  expect(unlisten).toHaveBeenCalled()
})

test('the map store merges the agents it is told about', () => {
  const s = createMapStore()
  const before = s.getState().agents
  s.getState().noteAgents([])
  expect(s.getState().agents).toBe(before)
  s.getState().noteAgents(['shared', 'a'])
  s.getState().noteAgents(['a', 'b'])
  expect(s.getState().agents).toEqual(['shared', 'a', 'b'])
})
