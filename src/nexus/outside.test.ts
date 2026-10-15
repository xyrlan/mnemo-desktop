vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => ({})) }))

import { tauriAccounts } from '../accounts/client'
import { openUrl } from '../github/actions'
import { child } from '../mission/fixtures'
import { openRule } from '../pulse/open'
import { vault } from '../vault/app-store'
import { appPaths } from './command/actions'
import { nexusRoutes, setNexusRoutes } from './outside'

// What the Nexus's routes were handed.
let seen: string[] = []
let unset = () => {}
beforeEach(() => {
  seen = []
  unset = setNexusRoutes({
    terminal: async (cwd, cmd, label) => void seen.push(`terminal ${cmd} · ${label}${cwd ? ` in ${cwd}` : ''}`),
    page: async (url) => void seen.push(`page ${url}`),
    pages: () => void seen.push('memory pages'),
  })
  vault.setState({ loaded: true, tree: [] } as never)
})
afterEach(() => unset())

const flush = () => new Promise((r) => setTimeout(r, 0))

test('a terminal opens in the drawer, a page in the system browser, a rule in Memory', async () => {
  openUrl('https://github.com/me/app/pull/7')
  await tauriAccounts.openTerminal('claude')
  await appPaths.stop('/Users/you/code/app', [child({ id: 'a1' })])
  await openRule('one-cargo-target')
  await flush()
  expect(seen).toEqual([
    'page https://github.com/me/app/pull/7',
    'terminal claude · Sign in',
    expect.stringMatching(/^terminal claude stop a1 · stop · app in \/Users\/you\/code\/app$/),
    'memory pages',
  ])
})

test('before the Nexus sets its routes, a terminal or a page is refused and nothing opens', async () => {
  unset()
  await expect(nexusRoutes().terminal(undefined, 'claude', 'Sign in')).rejects.toThrow('the Nexus has not started')
  await expect(nexusRoutes().page('https://github.com/')).rejects.toThrow('the Nexus has not started')
  nexusRoutes().pages()
  expect(seen).toEqual([])
})

test('an unset routes only what it set: a later setter keeps its own', async () => {
  const later = setNexusRoutes({ terminal: async () => void seen.push('later'), page: async () => {}, pages: () => {} })
  unset()
  await nexusRoutes().terminal(undefined, 'x', 'x')
  expect(seen).toEqual(['later'])
  later()
})
