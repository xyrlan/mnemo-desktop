// The drawer open on seven sessions (#467), as the last run left them: three children, two
// captains with long titles, two shells, a captain shown. Its one header: a pill each, and the
// shown captain's line once under them. At a window 1000 wide the drawer is 420: the pills wrap
// to two rows and the rest are behind `+N`.
import { scenario } from '../scenario.mjs'
import { appIpc, HOME, REPO } from '../fixtures/app.mjs'

const MNEMO = `${HOME}/code/mnemo`
const now = Date.now()
const iso = (ms) => new Date(ms).toISOString()

const COHORT = 'c0000001-1111-4000-8000-000000000001'
const AUDIT = 'c0000002-2222-4000-8000-000000000002'

const parent = (session_id, name, status) => ({ session_id, pid: 4000, name, status, cwd: REPO, waiting_for: null, account: 'default' })

const child = (n, issue, parentId, state, needs = null) => {
  const session_id = `d${String(n).padStart(7, '0')}-4444-4000-8000-00000000000${n}`
  return {
    id: session_id.slice(0, 8),
    session_id,
    name: `issue-${issue}`,
    state,
    tempo: 'active',
    needs,
    detail: 'working on the drawer',
    suggested_reply: null,
    cwd: `${REPO}-wt-${issue}`,
    tokens: 90_000,
    live: true,
    updated_at: iso(now - 60_000),
    intent: `Work on issue #${issue} in this repo: a synthetic issue for the preview`,
    branch: null,
    timeline_len: 20,
    parent_session: parentId,
    account: 'default',
  }
}

const crew = [child(1, 465, COHORT, 'running'), child(2, 471, COHORT, 'running'), child(3, 482, AUDIT, 'done')]

const MISSION = {
  repos: [{ root: REPO, name: 'mnemo-desktop', parents: [parent(COHORT, '[Pasted text #1 +12 lines]', 'busy'), parent(AUDIT, 'session c0000002', 'idle')], missions: [], children: crew }],
  errors: [],
  at: iso(now),
}

const session = (title, topic = null) => ({ activity: null, said: null, context: 140_000, model: 'claude-opus-4', topic, title, contract: null, ask: null })
const FEED = {
  sessions: {
    ...Object.fromEntries(crew.map((c) => [c.id, session(null)])),
    [COHORT]: session('Subscriber cohort analysis for the annual plans', 'which cohorts renew'),
    [AUDIT]: session('Windows build audit across every runner and every shell'),
  },
  prs: {},
  rate: null,
  at: now,
}

// The tabs the drawer kept (`mnemo.nexus-drawer.v1`), each on a pane of the saved workspace
// whose shell is still running (`pty_list`), so it comes back on it.
const TABS = [
  { id: crew[0].id, kind: 'robot', label: '#465', cwd: crew[0].cwd },
  { id: COHORT, kind: 'captain', label: 'Subscriber cohort analysis for the annual plans', cwd: REPO },
  { id: crew[1].id, kind: 'robot', label: '#471', cwd: crew[1].cwd },
  { id: 'session:4', kind: 'session', label: 'shell · mnemo-desktop', cwd: REPO },
  { id: AUDIT, kind: 'captain', label: 'Windows build audit across every runner and every shell', cwd: REPO },
  { id: crew[2].id, kind: 'robot', label: '#482', cwd: crew[2].cwd },
  { id: 'session:7', kind: 'session', label: 'shell · mnemo', cwd: MNEMO },
].map((t, i) => ({ ...t, sessionId: null, pane: i + 1 }))

scenario('nexus-drawer', {
  storage: { 'mnemo.nexus-drawer.v1': JSON.stringify({ tabs: TABS, active: COHORT }) },
  ipc: appIpc({
    mission_snapshot: MISSION,
    nexus_feed: () => FEED,
    mission_looked: {},
    mission_timeline: { lines: [], total: 0 },
    worktree_list: () => [],
    workspace_read: {
      version: 1,
      tabs: TABS.map((t) => ({ id: `tab-${t.pane}`, root: { kind: 'leaf', pane: t.pane }, focused: t.pane })),
      panes: Object.fromEntries(TABS.map((t) => [t.pane, { view: 'terminal', cwd: t.cwd }])),
      activeTab: 'tab-1',
    },
    pty_list: () => TABS.map((t) => ({ id: t.pane, cwd: t.cwd, pid: 4000 + t.pane, alive: true })),
    pty_write: null,
    pty_resize: null,
    pty_kill: null,
    pty_pid: 4242,
    pty_attach: () => [...new TextEncoder().encode('$ ')],
    worktree_diff_files: ({ worktree }) => ({ root: worktree, files: [], truncated: false }),
  }),
})
