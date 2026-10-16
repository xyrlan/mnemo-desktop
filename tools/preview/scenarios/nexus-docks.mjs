// Docks only, as when small work runs in parents alone: no live child, so every repo is a pod. The
// docks are drawn at full strength, and a parent says how it stands: one busy, one idle a few
// minutes, two asleep (idle 3 h, and a day), one waiting on you. Synthetic data.
import { scenario } from '../scenario.mjs'
import { appIpc, HOME, REPO } from '../fixtures/app.mjs'

const MNEMO = `${HOME}/code/mnemo`
const SITE = `${HOME}/code/site`
const now = Date.now()
const iso = (ms) => new Date(ms).toISOString()
const MIN = 60_000
const HOUR = 60 * MIN

const id = (n) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4000-8000-00000000000${n}`
const parent = (n, cwd, status, waiting_for = null) => ({ session_id: id(n), pid: 4000 + n, name: null, status, cwd, waiting_for, account: 'default' })

const MISSION = {
  repos: [
    { root: REPO, name: 'mnemo-desktop', parents: [parent(1, REPO, 'busy'), parent(2, REPO, 'idle'), parent(3, REPO, 'idle')], missions: [], children: [] },
    { root: MNEMO, name: 'mnemo', parents: [parent(4, MNEMO, 'idle')], missions: [], children: [] },
    { root: SITE, name: 'site', parents: [parent(5, SITE, 'waiting', 'permission prompt')], missions: [], children: [] },
  ],
  errors: [],
  at: iso(now),
}

const session = (at, title, saidAgo) => ({
  activity: null,
  said: { text: 'Done: the branch is pushed.', at: at - saidAgo },
  context: 90_000,
  model: 'claude-opus-4',
  topic: null,
  title,
  contract: null,
  ask: null,
})
// Dated when asked, not when loaded: the hover's `idle for 6 min` holds however long the run takes.
const feed = (at) => ({
  sessions: {
    [id(1)]: session(at, 'Fix the tab strip overflow', 20_000),
    [id(2)]: session(at, 'Review the release notes', 6 * MIN),
    [id(3)]: session(at, 'Payment status cleanup', 3 * HOUR),
    [id(4)]: session(at, 'Reflex log by project', 26 * HOUR),
    [id(5)]: session(at, 'Landing page copy', 2 * MIN),
  },
  prs: {},
  rate: null,
  at,
})

/** Each docked parent's pose, by session id. */
export const DOCKED_POSES = { [id(1)]: 'busy', [id(2)]: 'idle', [id(3)]: 'asleep', [id(4)]: 'asleep', [id(5)]: 'alert' }

scenario('nexus-docks', {
  ipc: appIpc({
    mission_snapshot: MISSION,
    nexus_feed: () => feed(Date.now()),
    mission_looked: {},
    mission_timeline: { lines: [], total: 0 },
    worktree_list: () => [],
  }),
  events: [],
})
