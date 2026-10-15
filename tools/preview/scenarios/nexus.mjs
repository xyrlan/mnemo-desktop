// Nexus v2 open over the app (the app opens on it): one repo's deck with two captains and a crew in
// every zone, a blocked child on the bridge, green and running PRs in the hangar, a stranded child,
// twins, and a second repo docked. Synthetic data; the feed answers as `nexus_feed` would.
import { scenario } from '../scenario.mjs'
import { appIpc, HOME, REPO } from '../fixtures/app.mjs'

const MNEMO = `${HOME}/code/mnemo`
const now = Date.now()
const ago = (min) => now - min * 60_000
const iso = (ms) => new Date(ms).toISOString()

const ROUND = 'aaaaaaaa-1111-4000-8000-000000000001'
const AUDIT = 'bbbbbbbb-2222-4000-8000-000000000002'
const DOCKED = 'cccccccc-3333-4000-8000-000000000003'

const parent = (session_id, cwd, name, status) => ({ session_id, pid: 4000, name, status, cwd, waiting_for: null, account: 'default' })
const url = (n) => `https://github.com/xyrlan/mnemo-desktop/pull/${n}`
const pr = (n, ci = 'pass') => ({ number: n, url: url(n), state: 'OPEN', head: `fix/issue-${n - 100}`, ci })

const child = (n, issue, parentId, extra = {}) => {
  const session_id = `d${String(n).padStart(7, '0')}-4444-4000-8000-00000000000${n % 10}`
  return {
    id: session_id.slice(0, 8),
    session_id,
    name: `issue-${issue}`,
    state: 'running',
    tempo: 'active',
    needs: null,
    detail: '',
    suggested_reply: null,
    cwd: `${REPO}-wt-${issue}-${n}`,
    tokens: 90_000,
    live: true,
    updated_at: iso(ago(1)),
    intent: `Work on issue #${issue} in this repo: a synthetic issue for the preview`,
    branch: null,
    timeline_len: 20,
    parent_session: parentId,
    account: 'default',
    ...extra,
  }
}

const crew = [
  child(1, 682, ROUND, { detail: 'moving the reviewer into tools/, tests next' }),
  child(2, 683, ROUND, { detail: 'full suite running before the PR' }),
  child(3, 684, ROUND, { state: 'done', tempo: 'idle', live: false, updated_at: iso(ago(40)), detail: 'PR open, CI green', pr: pr(701) }),
  child(4, 685, AUDIT, { state: 'done', tempo: 'idle', live: false, updated_at: iso(ago(6)), detail: 'PR open, CI running', pr: pr(702, 'pending') }),
  child(5, 686, AUDIT, { tempo: 'idle', updated_at: iso(ago(25)), detail: 'waiting on a flaky Windows job' }),
  child(6, 687, ROUND, { tempo: 'blocked', needs: 'Two tests in another module import the reviewer. Move it to tools/, or delete those tests too?', waiting_for: 'input needed', detail: 'asking where the reviewer goes' }),
  child(7, 690, ROUND, { detail: 'twin A: reading the pane store' }),
  child(8, 690, ROUND, { detail: 'twin B: reading the terminal view' }),
]

const MISSION = {
  repos: [
    { root: REPO, name: 'mnemo-desktop', parents: [parent(ROUND, REPO, 'Nexus v2 round', 'busy'), parent(AUDIT, REPO, 'Windows audit', 'idle')], missions: [], children: crew },
    { root: MNEMO, name: 'mnemo', parents: [parent(DOCKED, MNEMO, 'Release notes', 'idle')], missions: [], children: [] },
  ],
  errors: [],
  at: iso(now),
}

const act = (tool, target, min, running = false) => ({ tool, target, at: ago(min), running })
const feedOf = {
  [crew[0].id]: { activity: act('Edit', 'review.py', 0.3), said: { text: 'Moved the reviewer; now the tests that import it.', at: ago(0.5) } },
  [crew[1].id]: { activity: act('Bash', 'pnpm test', 9, true), said: { text: 'Running the full suite before opening the PR.', at: ago(9) } },
  [crew[2].id]: { activity: act('Bash', 'gh pr create', 41), said: { text: 'Closing report: PR #701 is open and green.', at: ago(40) } },
  [crew[3].id]: { activity: act('Bash', 'gh pr checks --watch', 7), said: { text: 'Closing report: PR #702 is open; CI is running.', at: ago(6) } },
  [crew[4].id]: { activity: act('Read', 'ci.yml', 25), said: { text: 'The Windows job timed out again; waiting for it.', at: ago(25) } },
  [crew[5].id]: { activity: act('AskUserQuestion', 'Where should the reviewer go?', 2, true), said: null, ask: { question: 'Two tests in another module import the reviewer. Move it to tools/, or delete those tests too?', options: ['Move it to tools/', 'Delete the tests'] } },
  [crew[6].id]: { activity: act('Read', 'store.ts', 0.2), said: { text: 'Reading how panes hold their sinks.', at: ago(0.4) } },
  [crew[7].id]: { activity: act('Grep', 'attachSink', 0.6), said: { text: 'Looking for every caller of attachSink.', at: ago(0.8) } },
}
const FEED = {
  sessions: Object.fromEntries([
    ...Object.entries(feedOf).map(([k, v]) => [k, { context: 120_000, model: 'claude-opus-4', topic: null, contract: null, ask: null, said: null, ...v }]),
    [ROUND, { activity: act('Bash', 'mnemo sessions', 0.5), said: { text: 'Five children out; reviewing as they land.', at: ago(1) }, context: 180_000, model: 'claude-opus-4', topic: 'Build Nexus v2 from the contract', contract: null, ask: null }],
    [AUDIT, { activity: null, said: { text: 'Waiting for the Windows job.', at: ago(30) }, context: 90_000, model: 'claude-opus-4', topic: 'Audit the Windows build', contract: null, ask: null }],
  ]),
  prs: {
    [url(701)]: { state: 'OPEN', mergedAt: null, closedAt: null, checks: [{ name: 'test (ubuntu-latest)', startedAt: ago(38), completedAt: ago(30), conclusion: 'SUCCESS' }, { name: 'test (macos-latest)', startedAt: ago(38), completedAt: ago(29), conclusion: 'SUCCESS' }] },
    [url(702)]: { state: 'OPEN', mergedAt: null, closedAt: null, checks: [{ name: 'test (ubuntu-latest)', startedAt: ago(5), completedAt: null, conclusion: null }] },
  },
  rate: { callsPerMin: 7, outPerMin: 9_000, inPerMin: 410_000, cacheShare: 0.93 },
  at: now,
}

scenario('nexus', {
  ipc: appIpc({
    settings_read: { nexusAtLaunch: true },
    mission_snapshot: MISSION,
    nexus_feed: () => FEED,
    home_snapshot: { repos: [], clone_base: `${HOME}/code`, errors: [], protected: 0 },
    mission_looked: {},
    mission_timeline: { lines: [], total: 0 },
    worktree_list: () => [],
  }),
  events: [],
})
