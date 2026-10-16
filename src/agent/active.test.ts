import type { Account } from '../accounts/types'
import { activeAgent, DEFAULT_AGENT } from './active'

const account = (over: Partial<Account>): Account => ({ id: 'x', label: 'X', configDir: '/Users/me/.claude', isDefault: false, kind: 'claude', email: null, problem: null, unshared: [], ...over })

test('the active account’s CLI and home, as a pane spawned now runs with them', () => {
  const accounts = [
    account({ id: 'default', isDefault: true }),
    account({ id: 'work', configDir: '/Users/me/.claude-work' }),
    account({ id: 'grok', configDir: '/Users/me/.grok', kind: 'grok' }),
    account({ id: 'grok-2', configDir: '/Users/me/.grok-2', kind: 'grok' }),
  ]
  expect(activeAgent({ active: 'default', accounts })).toEqual({ kind: 'claude', config_dir: null })
  expect(activeAgent({ active: 'work', accounts })).toEqual({ kind: 'claude', config_dir: '/Users/me/.claude-work' })
  expect(activeAgent({ active: 'grok', accounts })).toEqual({ kind: 'grok', config_dir: null })
  expect(activeAgent({ active: 'grok-2', accounts })).toEqual({ kind: 'grok', config_dir: '/Users/me/.grok-2' })
  // Unread, or naming no account it has: the default one, which a new pane runs on then too.
  expect(activeAgent(null)).toEqual(DEFAULT_AGENT)
  expect(activeAgent({ active: 'gone', accounts })).toEqual(DEFAULT_AGENT)
})
