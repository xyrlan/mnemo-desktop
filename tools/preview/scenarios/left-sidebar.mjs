// The left sidebar with a working fleet: two repos, their worktrees, and agents in every state —
// one asking permission, a card with several agents, a dispatched child with an open PR, and
// one finishing (a `stop` hook) after launch, which leaves its card unread.
import { scenario } from '../scenario.mjs'
import { appIpc, HOME, REPO } from '../fixtures/app.mjs'

const VAULT = `${HOME}/code/vault-tools`
const at = Date.parse('2026-09-24T12:00:00Z')
const ago = (min) => at - min * 60_000

const tree = (path, branch, more = {}) => ({ path, branch, head: 'a'.repeat(40), isMain: false, dispatched: false, dirty: false, setupJob: null, ...more })
const WORKTREES = {
  [REPO]: [
    tree(REPO, 'main', { isMain: true }),
    tree(`${REPO}-wt-login`, 'fix/login-redirect'),
    tree(`${REPO}-wt-left-sidebar`, 'feat/orca-redesign-b/left-sidebar', { dispatched: true }),
    tree(`${REPO}-wt-flaky-tests`, 'chore/flaky-tests'),
    tree(`${REPO}-wt-release`, 'release/0.2.1'),
  ],
  [VAULT]: [tree(VAULT, 'main', { isMain: true }), tree(`${VAULT}-wt-graph`, 'feat/graph-export')],
}

const session = (id, title, cwd) => ({ id, title, cwd, last_at: ago(3), transcript: true, live: 'here', kind: 'interactive', agent: null })
const homeRepo = (root, name, sessions) => ({ root, name, last_at: ago(1), pinned: false, hidden: false, unresolved: false, sessions, children: [] })

const parent = (session_id, cwd, status, waiting_for = null) => ({ session_id, pid: 100, name: null, status, cwd, waiting_for })
const pr = (number, head, state, ci) => ({ number, url: `https://github.com/preview/mnemo-desktop/pull/${number}`, state, head, ci })
const child = (id, cwd, branch, more) => ({
  id,
  session_id: `${id}-session`,
  name: null,
  state: 'running',
  tempo: 'steady',
  needs: null,
  detail: '',
  suggested_reply: null,
  cwd,
  tokens: 120_000,
  live: true,
  updated_at: '2026-09-24T11:58:00Z',
  intent: 'Port Orca’s left sidebar',
  branch,
  timeline_len: 40,
  ...more,
})

scenario('left-sidebar', {
  ipc: appIpc({
    home_snapshot: {
      repos: [
        homeRepo(REPO, 'mnemo-desktop', [
          session('s-login', 'Fix the login redirect loop', `${REPO}-wt-login`),
          session('s-flaky-1', 'Stabilise the pty tests', `${REPO}-wt-flaky-tests`),
          session('s-flaky-2', 'Retry the Windows runner', `${REPO}-wt-flaky-tests`),
          session('s-flaky-3', 'Which timeout do we keep?', `${REPO}-wt-flaky-tests`),
          session('s-main', 'Triage issues', REPO),
        ]),
        homeRepo(VAULT, 'vault-tools', [session('s-graph', 'Export the vault graph as SVG', `${VAULT}-wt-graph`)]),
      ],
      clone_base: `${HOME}/code`,
      errors: [],
      protected: 0,
    },
    worktree_list: ({ repo }) => WORKTREES[repo] ?? [],
    // The current mission sidebar reads which children were looked at; none here.
    mission_looked: {},
    gh_auth: { installed: true, logged: true, login: 'preview', scopes: ['repo'] },
    mission_snapshot: {
      repos: [
        {
          root: REPO,
          name: 'mnemo-desktop',
          parents: [
            parent('s-login', `${REPO}-wt-login`, 'waiting', 'permission prompt'),
            parent('s-flaky-1', `${REPO}-wt-flaky-tests`, 'busy'),
            parent('s-flaky-2', `${REPO}-wt-flaky-tests`, 'busy'),
            parent('s-flaky-3', `${REPO}-wt-flaky-tests`, 'waiting', 'input needed'),
            parent('s-main', REPO, 'idle'),
          ],
          missions: [],
          children: [
            child('c9f2', `${REPO}-wt-left-sidebar`, 'feat/orca-redesign-b/left-sidebar', { pr: pr(204, 'feat/orca-redesign-b/left-sidebar', 'OPEN', 'pending') }),
            child('b1e0', `${REPO}-wt-release`, 'release/0.2.1', { state: 'done', live: false, intent: 'Cut 0.2.1', pr: pr(198, 'release/0.2.1', 'MERGED', 'pass') }),
          ],
        },
        { root: VAULT, name: 'vault-tools', parents: [parent('s-graph', `${VAULT}-wt-graph`, 'busy')], missions: [], children: [] },
      ],
      errors: [],
      at: '2026-09-24T12:00:00Z',
    },
  }),
  // The graph export finishes after launch: its card is not on screen, so it turns unread.
  events: [{ event: 'agent://event', payload: { sessionId: 's-graph', cwd: `${VAULT}-wt-graph`, kind: 'stop', at: Date.now() + 1500 }, afterMs: 1500 }],
})
