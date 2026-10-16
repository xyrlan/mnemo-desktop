// A child that just ended while mnemo writes its briefing: a helper (a headless `claude --print`)
// runs in its worktree, so the robot scans its transcript with pages flying off, and no captain
// stands for the helper. Beside it, one child still working and one ended with no helper. Synthetic
// data.
import { scenario } from '../scenario.mjs'
import { appIpc, REPO } from '../fixtures/app.mjs'

const now = Date.now()
const iso = (ms) => new Date(ms).toISOString()
const MIN = 60_000

const P = '11111111-1111-4000-8000-000000000001'
const child = (n, over) => {
  const session_id = `d${String(n).padStart(7, '0')}-4444-4000-8000-00000000000${n}`
  return {
    id: session_id.slice(0, 8),
    session_id,
    name: `issue-${800 + n}`,
    state: 'running',
    tempo: 'active',
    needs: null,
    detail: '',
    suggested_reply: null,
    cwd: `${REPO}-wt-${800 + n}`,
    tokens: 90_000,
    live: true,
    updated_at: iso(now - 20_000),
    intent: `Work on issue #${800 + n} in this repo: a synthetic issue for the preview`,
    branch: null,
    timeline_len: 20,
    parent_session: P,
    account: 'default',
    ...over,
  }
}

const crew = [
  child(1, { detail: 'reading the deck geometry' }),
  child(2, { live: false, state: 'stopped', updated_at: iso(now - 2 * MIN), detail: 'Done: the fix is pushed and the PR is open.' }),
  child(3, { live: false, state: 'stopped', updated_at: iso(now - 3 * MIN), detail: 'Done: no change was needed.' }),
]

/** The robot mnemo is writing a briefing for, and the ones it is not. */
export const BRIEFING = { writing: '#802', not: ['#801', '#803'] }

const MISSION = {
  repos: [{ root: REPO, name: 'mnemo-desktop', parents: [{ session_id: P, pid: 4001, name: 'deck round', status: 'idle', cwd: REPO, waiting_for: null, account: 'default' }], missions: [], children: crew }],
  errors: [],
  at: iso(now),
  helpers: [{ cwd: crew[1].cwd, account: 'default' }],
}

const session = (title) => ({ activity: null, said: { text: 'Done.', at: now - MIN }, context: 90_000, model: 'claude-opus-4', topic: null, title, contract: null, ask: null })
const FEED = {
  sessions: Object.fromEntries([...crew.map((c) => [c.id, { ...session(null), said: null }]), [P, session('Deck round')]]),
  prs: {},
  rate: null,
  at: now,
}

scenario('nexus-briefing', {
  ipc: appIpc({
    mission_snapshot: MISSION,
    nexus_feed: () => FEED,
    mission_looked: {},
    mission_timeline: { lines: [], total: 0 },
    worktree_list: () => [],
  }),
  events: [],
})
