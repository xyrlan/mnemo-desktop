import { vi } from 'vitest'
import type { Agent, PageInfo } from '../vault/types'

const page = (dir: string, slug: string): PageInfo => ({ path: `${dir}/${slug}.md`, slug, name: slug, description: '', type: 'feedback', confidence: null, topics: [], modified: null, body: '' })
const tree: Agent[] = [
  { name: 'shared', kind: 'shared', dir: '/v/shared', groups: [{ type: 'feedback', pages: [page('/v/shared', 'run-tests')] }] },
  { name: 'mnemo-desktop', kind: 'repo', dir: '/v/bots/mnemo-desktop', groups: [{ type: 'feedback', pages: [page('/v/bots/mnemo-desktop', 'run-tests')] }] },
]
const calls: [string, unknown][] = []
vi.mock('@tauri-apps/api/core', () => ({
  Channel: class {},
  invoke: async (cmd: string, args: { path?: string }) => {
    calls.push([cmd, args])
    if (cmd === 'vault_tree') return tree
    if (cmd === 'vault_page') return { ...page('/v', 'x'), path: args.path, runtime: null, frontmatter: [], error: null }
    return null
  },
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))

import { openRule } from './open'
import { store } from '../layout/app-store'
import { vault } from '../vault/app-store'

test('opens the rule of the pulse project in a vault pane, in pages mode', async () => {
  vault.getState().setMode('graph')
  await openRule('run-tests', 'mnemo-desktop')
  expect(calls[0]).toEqual(['vault_tree', undefined])
  expect(vault.getState().selected).toBe('/v/bots/mnemo-desktop/run-tests.md')
  expect(vault.getState().mode).toBe('pages')
  const panes = Object.values(store.getState().panes)
  expect(panes.filter((p) => p.view === 'vault')).toHaveLength(1)

  // A second click reuses the pane; a rule elsewhere falls back to any agent's page.
  await openRule('run-tests', 'mnemo')
  expect(vault.getState().selected).toBe('/v/shared/run-tests.md')
  expect(Object.values(store.getState().panes).filter((p) => p.view === 'vault')).toHaveLength(1)
  expect(calls.filter(([c]) => c === 'vault_tree')).toHaveLength(1)
})

test('a slug the vault does not know becomes the search', async () => {
  await openRule('gone-rule')
  expect(vault.getState().query).toBe('gone-rule')
})
