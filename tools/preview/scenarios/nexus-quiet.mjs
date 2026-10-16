// A crowded COMMAND column, as #465 found it: one deck with two captains (one busy with a
// two-line title, one known only as `session <id>`), neither with a topic or an action pill,
// eight quiet captains below them with two-line titles, and the drawer open on the right with a
// restored terminal, so the ship is narrow. The quiet chips must start below the captains.
import { scenario } from '../scenario.mjs'
import { appIpc, REPO } from '../fixtures/app.mjs'

const now = Date.now()
const ago = (min) => now - min * 60_000
const iso = (ms) => new Date(ms).toISOString()

const id = (n) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4000-8000-00000000000${n}`
const BUSY = id(1)
const NAMELESS = id(2)
const QUIET = [3, 4, 5, 6, 7, 8, 9, 0].map((n) => `a${n}${String(n).repeat(6)}-0000-4000-8000-0000000000${n}0`)

const parent = (session_id, name, status) => ({ session_id, pid: 4000, name, status, cwd: REPO, waiting_for: null, account: 'default' })

const child = (n, parentId, detail) => {
  const session_id = `d${String(n).padStart(7, '0')}-4444-4000-8000-00000000000${n}`
  return {
    id: session_id.slice(0, 8),
    session_id,
    name: `issue-${700 + n}`,
    state: 'running',
    tempo: 'active',
    needs: null,
    detail,
    suggested_reply: null,
    cwd: `${REPO}-wt-${700 + n}`,
    tokens: 90_000,
    live: true,
    updated_at: iso(ago(1)),
    intent: `Work on issue #${700 + n} in this repo: a synthetic issue for the preview`,
    branch: null,
    timeline_len: 20,
    parent_session: parentId,
    account: 'default',
  }
}

const crew = [child(1, BUSY, 'reading the deck geometry'), child(2, NAMELESS, 'running the preview harness')]

const QUIET_TITLES = [
  'Release notes for the next minor version',
  'Windows build audit across every runner',
  'Mail relay setup for the notifications',
  'Merge conflict review for the drawer',
  'Onboarding plan for the first launch',
  'Dictation targets in the bridge prompt',
  'Account switcher usage bar polish',
  'Vault level shown in the Memory window',
]

const MISSION = {
  repos: [
    {
      root: REPO,
      name: 'mnemo-desktop',
      parents: [
        parent(BUSY, '[11/10/2026, 14:02:11] ok so the bar', 'busy'),
        parent(NAMELESS, `session ${NAMELESS.slice(0, 8)}`, 'idle'),
        ...QUIET.map((q, i) => parent(q, `[Pasted text #${i + 1} +12 lines]`, 'idle')),
      ],
      missions: [],
      children: crew,
    },
  ],
  errors: [],
  at: iso(now),
}

// No topic, no activity: neither captain draws a topic line or an action pill.
const captain = (title) => ({ activity: null, said: null, context: 90_000, model: 'claude-opus-4', topic: null, title, contract: null, ask: null })
const FEED = {
  sessions: Object.fromEntries([
    ...crew.map((c) => [c.id, { activity: null, said: null, context: 120_000, model: 'claude-opus-4', topic: null, title: null, contract: null, ask: null }]),
    [BUSY, captain('Name each captain by its session title, in two lines')],
    [NAMELESS, captain(null)],
    ...QUIET.map((q, i) => [q, captain(QUIET_TITLES[i])]),
  ]),
  prs: {},
  rate: null,
  at: now,
}

// The drawer's terminal: a saved workspace's pane, restored into a drawer tab (as `terminal-pane`).
let channel = null

scenario('nexus-quiet', {
  ipc: appIpc({
    mission_snapshot: MISSION,
    nexus_feed: () => FEED,
    mission_looked: {},
    mission_timeline: { lines: [], total: 0 },
    worktree_list: () => [],
    workspace_read: {
      version: 1,
      tabs: [{ id: 'tab-1', root: { kind: 'leaf', pane: 1 }, focused: 1 }],
      panes: { 1: { view: 'terminal', cwd: REPO } },
      activeTab: 'tab-1',
    },
    pty_spawn: ({ onOutput }) => {
      channel = onOutput
      setTimeout(() => void channel.sendBytes('$ '), 50)
      return 1
    },
    pty_write: null,
    pty_resize: null,
    pty_kill: null,
    pty_pid: 4242,
    pty_attach: ({ onOutput }) => {
      channel = onOutput
      return [...new TextEncoder().encode('$ ')]
    },
    worktree_diff_files: ({ worktree }) => ({ root: worktree, files: [], truncated: false }),
  }),
})
