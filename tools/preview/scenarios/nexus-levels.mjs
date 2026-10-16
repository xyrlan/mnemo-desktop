// Each deck's own level (#478): two repos with live children, so two decks, each with its own
// project's `LV` beside its archive (mnemo-desktop 7, mnemo 2), and a third repo docked whose
// project has no pages and no fires on record, so LV0. The vault's level (49) is another number,
// shown only in the Memory window. Synthetic data.
import { scenario } from '../scenario.mjs'
import { appIpc, HOME, REPO } from '../fixtures/app.mjs'
import { LEVELS } from './nexus-memory.mjs'

const MNEMO = `${HOME}/code/mnemo`
const SITE = `${HOME}/code/site`
const now = Date.now()
const iso = (ms) => new Date(ms).toISOString()

const id = (n) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4000-8000-00000000000${n}`
const parent = (session_id, cwd, name) => ({ session_id, pid: 4000, name, status: 'busy', cwd, waiting_for: null, account: 'default' })
const child = (n, repo, parentId, detail) => {
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
    cwd: `${repo}-wt-${700 + n}`,
    tokens: 90_000,
    live: true,
    updated_at: iso(now - 60_000),
    intent: `Work on issue #${700 + n} in this repo: a synthetic issue for the preview`,
    branch: null,
    timeline_len: 20,
    parent_session: parentId,
    account: 'default',
  }
}

const crew = [child(1, REPO, id(1), 'reading the deck geometry'), child(2, MNEMO, id(2), 'running the reflex tests')]

const MISSION = {
  repos: [
    { root: REPO, name: 'mnemo-desktop', parents: [parent(id(1), REPO, 'deck levels')], missions: [], children: [crew[0]] },
    { root: MNEMO, name: 'mnemo', parents: [parent(id(2), MNEMO, 'reflex log')], missions: [], children: [crew[1]] },
    { root: SITE, name: 'site', parents: [parent(id(3), SITE, 'landing page')], missions: [], children: [] },
  ],
  errors: [],
  at: iso(now),
}

const session = (title) => ({ activity: null, said: null, context: 90_000, model: 'claude-opus-4', topic: null, title, contract: null, ask: null })
const FEED = {
  sessions: Object.fromEntries([
    ...crew.map((c) => [c.id, session(null)]),
    [id(1), session('Each deck its own level')],
    [id(2), session('Project in every log row')],
    [id(3), session('Landing page copy')],
  ]),
  prs: {},
  rate: null,
  at: now,
}

scenario('nexus-levels', {
  ipc: appIpc({
    mission_snapshot: MISSION,
    nexus_feed: () => FEED,
    mission_looked: {},
    mission_timeline: { lines: [], total: 0 },
    worktree_list: () => [],
    vault_level: { root: `${HOME}/mnemo`, pages: 2413, rules_fired: 386, fires: 576, fired_recent: 320, dormant: 646, label_only: 0, inbox: 195, error: null },
    vault_project_levels: { root: `${HOME}/mnemo`, projects: LEVELS, error: null },
  }),
  events: [],
})
