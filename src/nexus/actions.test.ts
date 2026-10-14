import type { AccountsState } from '../accounts/types'
import type { RepoNode } from '../fleet/types'
import { makeActions, nexusAccount, type ActionDeps, type Offer } from './actions'
import { child, nexus, parent, robot } from './interact-fixtures'

// The live module's stores are never touched: every test builds its actions on recorders.
vi.mock('../layout/app-store', () => ({ store: { getState: () => ({}) } }))
vi.mock('../fleet/store', () => ({ fleetStore: { getState: () => ({ repos: [] }) } }))

const repo = (agents: { sessionId: string; paneId: number | null }[], path = '/work/mnemo-desktop'): RepoNode => ({
  root: '/work/mnemo-desktop',
  name: 'mnemo-desktop',
  worktrees: [{ path, name: 'main', branch: 'main', kind: 'main', pr: null, unread: false, agents: agents.map((a) => ({ ...a, state: 'working', waitingFor: null, title: 't', since: 0 })) }],
})

function rig(repos: RepoNode[] = [], accounts: AccountsState | null = null) {
  const did: string[] = []
  const said: { text: string; offer?: Offer }[] = []
  const deps: ActionDeps = {
    layout: () => ({
      switchWorktree: async (p) => void did.push(`switch ${p}`),
      goToPane: (id) => void did.push(`pane ${id}`),
      openCommandTab: async (cwd, cmd, sid) => void did.push(`tab ${cwd} | ${cmd} | ${sid}`),
    }),
    fleet: () => ({ repos, markRead: (p) => void did.push(`read ${p}`) }),
    accounts: () => accounts,
    attach: (c) => void did.push(`attach ${c.id}`),
    say: (text, offer) => void said.push({ text, offer }),
    showMemory: () => void did.push('memory'),
  }
  return { did, said, ...makeActions(deps) }
}

const TWO: AccountsState = {
  active: 'work',
  accounts: [
    { id: 'default', label: 'Personal', configDir: '/home/me/.claude', isDefault: true, email: null, problem: null, unshared: [] },
    { id: 'work', label: 'Work', configDir: '/home/me/.claude-work', isDefault: false, email: null, problem: null, unshared: [] },
  ],
}

test('a live nexus with a pane in the app is revealed the way a kanban card is', () => {
  const n = nexus()
  const r = rig([repo([{ sessionId: n.sessionId, paneId: 7 }], '/work/mnemo-desktop-wt-9')])
  r.openNexus(n)
  expect(r.did).toEqual(['switch /work/mnemo-desktop-wt-9', 'pane 7', 'read /work/mnemo-desktop-wt-9'])
  expect(r.said).toEqual([])
})

test('a live nexus outside the app is only named: nothing opens a second copy', () => {
  const n = nexus()
  for (const repos of [[], [repo([{ sessionId: n.sessionId, paneId: null }])]]) {
    const r = rig(repos)
    r.openNexus(n)
    expect(r.did).toEqual([])
    expect(r.said).toHaveLength(1)
    expect(r.said[0].text).toContain('outside the app')
    expect(r.said[0].offer).toBeUndefined()
  }
})

test('a dead nexus offers `claude --resume` in a new terminal, and opens nothing until taken', () => {
  const n = nexus({ pose: 'dead', parent: null, sessionId: '33333333-0000-4000-8000-000000000003', cwd: '/work/mnemo-desktop' })
  const r = rig()
  r.openNexus(n)
  expect(r.did).toEqual([])
  expect(r.said[0].offer?.label).toBe('Resume')
  r.said[0].offer!.run()
  expect(r.did).toEqual([`tab /work/mnemo-desktop | claude --resume ${n.sessionId} | ${n.sessionId}`])
})

test('a dead nexus never reveals a pane its ended session left behind', () => {
  const n = nexus({ pose: 'dead' })
  const r = rig([repo([{ sessionId: n.sessionId, paneId: 3 }])])
  r.openNexus(n)
  expect(r.did).toEqual([])
  expect(r.said[0].offer).toBeDefined()
})

test('the resume runs on the parent’s account, else on its children’s', () => {
  // On the default account while another is active: the variable is unset in front of it.
  const onDefault = nexus({ parent: parent({ account: 'default' }) })
  expect(nexusAccount(onDefault, TWO)?.account_env).toEqual({ config_dir: null })
  expect(nexusAccount(nexus({ parent: parent({ account: 'work' }) }), TWO)?.account_env).toEqual({ config_dir: '/home/me/.claude-work' })
  // One account only: typed as it always was.
  expect(nexusAccount(onDefault, { active: 'default', accounts: [TWO.accounts[0]] })).toBeNull()

  const env = { config_dir: '/home/me/.claude-work' }
  const dead = nexus({ pose: 'dead', parent: null, robots: [robot({ child: child({ account: 'work', account_env: env }) })] })
  expect(nexusAccount(dead, TWO)?.account_env).toEqual(env)
  const r = rig([], TWO)
  r.openNexus(dead)
  r.said[0].offer!.run()
  expect(r.did[0]).toContain('CLAUDE_CONFIG_DIR')
  expect(r.did[0]).toContain('/home/me/.claude-work')
  expect(r.did[0]).toContain(`claude --resume ${dead.sessionId}`)
})

test('a robot is attached on its own account', () => {
  const r = rig()
  r.openRobot(robot({ child: child({ id: 'f00dbabe' }) }))
  expect(r.did).toEqual(['attach f00dbabe'])
})

test('an archive shows its territory’s main checkout and the Memory panel', () => {
  const r = rig()
  r.openArchive('/work/mnemo-desktop', { project: 'mnemo-desktop', pages: 12, tier: 1 })
  expect(r.did).toEqual(['switch /work/mnemo-desktop', 'read /work/mnemo-desktop', 'memory'])
})
