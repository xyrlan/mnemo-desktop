vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => ({})) }))

import { tauriAccounts } from '../accounts/client'
import { ghLogin, installGh, openUrl } from '../github/actions'
import { store as layout } from '../layout/app-store'
import { child } from '../mission/fixtures'
import { openRule } from '../pulse/open'
import { vault } from '../vault/app-store'
import { appPaths } from './command/actions'
import { nexusRoutes, setNexusRoutes } from './outside'

// What the workbench's own paths opened, and what the Nexus's routes were handed.
const seen = { workbench: [] as string[], nexus: [] as string[] }
let open = true
let unset = () => {}
beforeEach(() => {
  seen.workbench = []
  seen.nexus = []
  open = true
  layout.setState({
    openView: (view: string, params: { url?: string }) => void seen.workbench.push(`view ${view} ${params.url ?? ''}`.trim()),
    openCommandTab: async (_cwd: string | undefined, cmd?: string) => void seen.workbench.push(`terminal ${cmd}`),
  } as never)
  unset = setNexusRoutes(
    {
      terminal: async (cwd, cmd, label) => void seen.nexus.push(`terminal ${cmd} · ${label}${cwd ? ` in ${cwd}` : ''}`),
      page: async (url) => void seen.nexus.push(`page ${url}`),
      pages: () => void seen.nexus.push('memory pages'),
    },
    () => open,
  )
  vault.setState({ loaded: true, tree: [] } as never)
})
afterEach(() => unset())

const flush = () => new Promise((r) => setTimeout(r, 0))

test('with the Nexus open, a terminal opens in its drawer, a page in the system browser, a rule in Memory: nothing in the workbench under it', async () => {
  openUrl('https://github.com/me/app/pull/7', '#7')
  ghLogin()
  installGh()
  await tauriAccounts.openTerminal('claude')
  await appPaths.stop('/Users/you/code/app', [child({ id: 'a1' })])
  await openRule('one-cargo-target')
  await flush()
  expect(seen.workbench).toEqual([])
  expect(seen.nexus).toEqual([
    'page https://github.com/me/app/pull/7',
    'terminal gh auth login --web · gh auth login',
    expect.stringMatching(/^terminal .+ · Install gh$/),
    'terminal claude · Sign in',
    expect.stringMatching(/^terminal claude stop a1 · stop · app in \/Users\/you\/code\/app$/),
    'memory pages',
  ])
})

test('with the Nexus closed, they open in the workbench as before', async () => {
  open = false
  expect(nexusRoutes()).toBeNull()
  openUrl('https://github.com/me/app/pull/7', '#7')
  await tauriAccounts.openTerminal('claude')
  await appPaths.stop('/Users/you/code/app', [child({ id: 'a1' })])
  await openRule('one-cargo-target')
  await flush()
  expect(seen.nexus).toEqual([])
  expect(seen.workbench).toEqual(['view browser https://github.com/me/app/pull/7', 'terminal claude', expect.stringMatching(/^terminal claude stop a1/), 'view vault'])
})
