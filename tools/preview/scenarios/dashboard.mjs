// The agent dashboard open over the app: two repos, interactive sessions and dispatched children
// in every column. After it opens, one working session finishes (a `Stop` hook), so its card
// moves to Done and shows unseen.
import { scenario } from '../scenario.mjs'
import { appIpc, HOME, REPO } from '../fixtures/app.mjs'

const VAULT = `${HOME}/code/vault-tools`
const now = Date.now()
const recent = new Date(now - 20 * 60_000).toISOString()

const tree = (repo, name, branch, extra = {}) => ({
  path: name ? `${repo}-wt-${name}` : repo,
  branch: `refs/heads/${branch}`,
  head: '0a7a6a982878681f399c03bd5c438cba5634d7cd',
  isMain: !name,
  dispatched: false,
  dirty: false,
  setupJob: null,
  ...extra,
})

const WORKTREES = {
  [REPO]: [
    tree(REPO, null, 'main'),
    tree(REPO, 'tab-strip', 'feat/tab-strip'),
    tree(REPO, 'status-bar', 'feat/status-bar'),
    tree(REPO, 'dashboard', 'feat/orca-redesign-b/dashboard', { dispatched: true }),
    tree(REPO, 'jump-palette', 'feat/orca-redesign-b/jump-palette', { dispatched: true }),
  ],
  [VAULT]: [tree(VAULT, null, 'main'), tree(VAULT, 'fix-sync', 'fix/sync-race', { dispatched: true })],
}

const parent = (session_id, cwd, name, status, waiting_for = null) => ({ session_id, pid: 4000, name, status, cwd, waiting_for })

const child = (id, cwd, name, extra) => ({
  id: id.slice(0, 8),
  session_id: id,
  name,
  state: 'running',
  tempo: 'active',
  needs: null,
  detail: '',
  suggested_reply: null,
  cwd,
  tokens: 120_000,
  live: true,
  updated_at: recent,
  intent: name,
  branch: null,
  timeline_len: 12,
  ...extra,
})

const pr = (number) => ({ number, url: `https://github.com/xyrlan/mnemo-desktop/pull/${number}`, state: 'OPEN', head: 'x', ci: 'pass' })

const ASKING = '11111111-aaaa-4000-8000-000000000001'
const TABS = '22222222-aaaa-4000-8000-000000000002'
const STATUS = '33333333-aaaa-4000-8000-000000000003'
const VAULT_IDLE = '44444444-aaaa-4000-8000-000000000004'

const MISSION = {
  repos: [
    {
      root: REPO,
      name: 'mnemo-desktop',
      parents: [
        parent(ASKING, REPO, 'Review the wave-B contract', 'waiting', 'permission prompt'),
        parent(TABS, `${REPO}-wt-tab-strip`, 'Drag to reorder tabs', 'busy'),
        parent(STATUS, `${REPO}-wt-status-bar`, 'Status bar token meter', 'busy'),
      ],
      missions: [],
      children: [
        child('55555555-bbbb-4000-8000-000000000005', `${REPO}-wt-dashboard`, 'Agent dashboard kanban', {}),
        child('66666666-bbbb-4000-8000-000000000006', `${REPO}-wt-jump-palette`, 'Worktree jump palette', { state: 'done', live: false, pr: pr(201) }),
      ],
    },
    {
      root: VAULT,
      name: 'vault-tools',
      parents: [parent(VAULT_IDLE, VAULT, 'Tidy the README', 'idle')],
      missions: [],
      children: [
        child('77777777-bbbb-4000-8000-000000000007', `${VAULT}-wt-fix-sync`, 'Fix the sync race', {
          tempo: 'blocked',
          needs: 'Which branch should the fix be based on?',
          waiting_for: 'input needed',
        }),
      ],
    },
  ],
  errors: [],
  at: new Date(now).toISOString(),
}

const homeRepo = (root, name, pinned) => ({ root, name, last_at: now, pinned, hidden: false, unresolved: false, sessions: [], children: [] })

scenario('dashboard', {
  ipc: appIpc({
    home_snapshot: { repos: [homeRepo(REPO, 'mnemo-desktop', true), homeRepo(VAULT, 'vault-tools', false)], clone_base: `${HOME}/code`, errors: [], protected: 0 },
    mission_snapshot: MISSION,
    worktree_list: ({ repo }) => WORKTREES[repo] ?? [],
    // Children in the snapshot: today's sidebar reads when each was last looked at.
    mission_looked: {},
  }),
  events: [
    // The native menu's way of running an action: what the left sidebar's entry will run.
    { event: 'app://action', payload: { id: 'dashboard.toggle' }, afterMs: 1200 },
    // The status-bar session's turn ends: Working → Done.
    { event: 'agent://event', payload: { sessionId: STATUS, cwd: `${REPO}-wt-status-bar`, kind: 'stop', at: now + 2000 }, afterMs: 2000 },
  ],
})
