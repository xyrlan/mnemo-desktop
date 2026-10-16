// Every robot state a snapshot can make (#473), one robot each, across the four classes: working
// on a read, an edit, a test, a ship and a long command; waiting for you (on the bridge); finished
// with CI green, red and running; idle; stranded. Each shows its state by its pose and the prop it
// holds (none when idle or stranded), never a badge. The twelfth, `stopped`, no snapshot makes
// (the ship turns a stopped child idle, then done); the unit tests draw it. Synthetic data.
import { scenario } from '../scenario.mjs'
import { appIpc, REPO } from '../fixtures/app.mjs'

const now = Date.now()
const ago = (min) => now - min * 60_000
const iso = (ms) => new Date(ms).toISOString()

const CAPTAIN = 'aaaaaaaa-4730-4000-8000-000000000001'
const url = (n) => `https://github.com/xyrlan/mnemo-desktop/pull/${n}`
const pr = (n, ci) => ({ number: n, url: url(n), state: 'OPEN', head: `fix/issue-${n - 100}`, ci })

const MODELS = ['claude-opus-4', 'claude-sonnet-4', 'claude-haiku-4', 'local-model']

const child = (n, extra = {}) => {
  const session_id = `d${String(n).padStart(7, '0')}-4730-4000-8000-0000000000${String(n).padStart(2, '0')}`
  return {
    id: session_id.slice(0, 8),
    session_id,
    name: `issue-${700 + n}`,
    state: 'running',
    tempo: 'active',
    needs: null,
    detail: '',
    suggested_reply: null,
    cwd: `${REPO}-wt-${700 + n}`,
    tokens: 90_000,
    live: true,
    updated_at: iso(ago(0.2)),
    intent: `Work on issue #${700 + n} in this repo: a synthetic issue for the preview`,
    branch: null,
    timeline_len: 20,
    parent_session: CAPTAIN,
    account: 'default',
    model: MODELS[n % MODELS.length],
    ...extra,
  }
}

const done = (n, ci, minAgo) => child(n, { state: 'done', tempo: 'idle', live: false, updated_at: iso(ago(minAgo)), pr: pr(800 + n, ci) })
const act = (tool, target, min, running = false) => ({ tool, target, at: ago(min), running })

/** Each state: the child, and its feed (what it last did, said, or asks). */
const STATES = [
  ['read', child(1), { activity: act('Read', 'src/nexus/ship.ts', 0.2) }],
  ['edit', child(2), { activity: act('Edit', 'src/nexus/ship.css', 0.2) }],
  ['test', child(3), { activity: act('Bash', 'pnpm test', 0.5, true) }],
  ['ship', child(4), { activity: act('Bash', 'git push -u origin fix/issue-704', 0.3, true) }],
  ['run', child(5, { updated_at: iso(ago(9)) }), { activity: act('Bash', 'cargo build --release', 9, true) }],
  ['need', child(6, { tempo: 'blocked', waiting_for: 'input needed' }), { activity: act('AskUserQuestion', 'Which way?', 1, true), ask: { question: 'Keep the badge in the log, or drop it there too?', options: ['Keep it', 'Drop it'] } }],
  ['ci-green', done(7, 'pass', 30), {}],
  ['ci-red', done(8, 'fail', 25), {}],
  ['ci-run', done(9, 'pending', 6), {}],
  ['idle', child(10, { tempo: 'idle', updated_at: iso(ago(5)) }), { activity: act('Read', 'README.md', 5) }],
  ['stranded', child(11, { tempo: 'idle', updated_at: iso(ago(25)) }), { activity: act('Read', 'ci.yml', 25) }],
]

/** What the guard expects of each robot, by its label: the prop it holds (null: none). */
const PROP = { 'ci-green': 'green', 'ci-red': 'red', 'ci-run': 'run', idle: null, stranded: null }
export const STATE_PROPS = Object.fromEntries(STATES.map(([state, c]) => [`#${c.cwd.split("-wt-")[1]}`, state in PROP ? PROP[state] : state]))

const MISSION = {
  repos: [
    {
      root: REPO,
      name: 'mnemo-desktop',
      parents: [{ session_id: CAPTAIN, pid: 4000, name: 'robot states', status: 'busy', cwd: REPO, waiting_for: null, account: 'default' }],
      missions: [],
      children: STATES.map(([, c]) => c),
    },
  ],
  errors: [],
  at: iso(now),
}

const checks = (state) =>
  state === 'run'
    ? [{ name: 'test (ubuntu-latest)', startedAt: ago(5), completedAt: null, conclusion: null }]
    : [{ name: 'test (ubuntu-latest)', startedAt: ago(40), completedAt: ago(32), conclusion: state === 'red' ? 'FAILURE' : 'SUCCESS' }]

const FEED = {
  sessions: Object.fromEntries([
    ...STATES.map(([, c, f]) => [c.id, { activity: null, said: null, context: 120_000, model: c.model, topic: null, title: null, contract: null, ask: null, ...f }]),
    [CAPTAIN, { activity: act('Bash', 'mnemo dispatch', 0.5), said: null, context: 90_000, model: 'claude-opus-4', topic: 'show every robot state', title: 'Robot states by prop', contract: null, ask: null }],
  ]),
  prs: { [url(807)]: { state: 'OPEN', mergedAt: null, closedAt: null, checks: checks('green') }, [url(808)]: { state: 'OPEN', mergedAt: null, closedAt: null, checks: checks('red') }, [url(809)]: { state: 'OPEN', mergedAt: null, closedAt: null, checks: checks('run') } },
  rate: null,
  at: now,
}

scenario('nexus-states', {
  ipc: appIpc({
    mission_snapshot: MISSION,
    nexus_feed: () => FEED,
    mission_looked: {},
    mission_timeline: { lines: [], total: 0 },
    worktree_list: () => [],
  }),
})
