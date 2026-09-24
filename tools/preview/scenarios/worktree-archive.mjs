// The cleanup view over a repo full of finished work, opened through `worktree.cleanup` (the
// native menu's `app://action`): two dispatched children whose PRs merged, one whose PR was
// closed, a branch merged by hand — all clean, so all listed — and, kept out of the list, a
// merged tree with changes, one with an agent at work and one not merged at all.
import { scenario } from '../scenario.mjs'
import { appIpc, HOME, REPO } from '../fixtures/app.mjs'

const at = Date.parse('2026-09-24T12:00:00Z')
const ago = (min) => at - min * 60_000

const tree = (name, branch, more = {}) => ({
  path: name ? `${REPO}-wt-${name}` : REPO,
  branch,
  head: 'a'.repeat(40),
  isMain: !name,
  dispatched: false,
  dirty: false,
  setupJob: null,
  merged: false,
  ...more,
})
const TREES = [
  tree('', 'main'),
  tree('c-statusbar', 'feat/orca-redesign-b/status-bar', { dispatched: true }),
  tree('c-pet', 'feat/orca-redesign-b/pet', { dispatched: true }),
  tree('spike-virtuoso', 'spike/virtuoso'),
  tree('fix-181', 'fix-181', { merged: true }),
  tree('release', 'release/0.2.1', { merged: true, dirty: true }),
  tree('login', 'fix/login-redirect'),
  tree('graph', 'feat/graph-export'),
]
const info = ({ merged: _merged, ...t }) => t

const session = (id, title, cwd) => ({ id, title, cwd, last_at: ago(3), transcript: true, live: 'here', kind: 'interactive', agent: null })
const parent = (session_id, cwd, status) => ({ session_id, pid: 100, name: null, status, cwd, waiting_for: null })
const pr = (number, head, state) => ({ number, url: `https://github.com/preview/mnemo-desktop/pull/${number}`, state, head, ci: 'pass' })
const child = (id, name, branch, prState, number) => ({
  id,
  session_id: `${id}-session`,
  name: null,
  state: 'done',
  tempo: 'steady',
  needs: null,
  detail: '',
  suggested_reply: null,
  cwd: `${REPO}-wt-${name}`,
  tokens: 120_000,
  live: false,
  updated_at: '2026-09-24T11:58:00Z',
  intent: 'A wave-B piece',
  branch,
  timeline_len: 40,
  pr: pr(number, branch, prState),
})

scenario('worktree-archive', {
  ipc: appIpc({
    home_snapshot: {
      repos: [
        {
          root: REPO,
          name: 'mnemo-desktop',
          last_at: ago(1),
          pinned: false,
          hidden: false,
          unresolved: false,
          sessions: [session('s-login', 'Fix the login redirect loop', `${REPO}-wt-login`)],
          children: [],
        },
      ],
      clone_base: `${HOME}/code`,
      errors: [],
      protected: 0,
    },
    worktree_list: () => TREES.map(info),
    worktree_cleanup_facts: () => ({ base: 'origin/main', trees: TREES.filter((t) => !t.isMain) }),
    mission_looked: {},
    gh_auth: { installed: true, logged: true, login: 'preview', scopes: ['repo'] },
    mission_snapshot: {
      repos: [
        {
          root: REPO,
          name: 'mnemo-desktop',
          parents: [parent('s-login', `${REPO}-wt-login`, 'busy')],
          missions: [],
          children: [
            child('a1', 'c-statusbar', 'feat/orca-redesign-b/status-bar', 'MERGED', 205),
            child('a2', 'c-pet', 'feat/orca-redesign-b/pet', 'MERGED', 207),
            child('a3', 'spike-virtuoso', 'spike/virtuoso', 'CLOSED', 188),
          ],
        },
      ],
      errors: [],
      at: '2026-09-24T12:00:00Z',
    },
  }),
  events: [{ event: 'app://action', payload: { id: 'worktree.cleanup' }, afterMs: 1500 }],
})
