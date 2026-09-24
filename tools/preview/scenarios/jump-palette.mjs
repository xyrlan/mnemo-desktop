// The worktree jump palette (Mod+J) open over a fleet of two projects: a worktree whose agent
// waits on a permission, one working, one idle, and trees with no agent.
import { scenario } from '../scenario.mjs'
import { appIpc, HOME, REPO } from '../fixtures/app.mjs'

const SITE = `${HOME}/code/website`
const repo = (root, name) => ({ root, name, last_at: 1_790_000_000, pinned: false, hidden: false, unresolved: false, sessions: [], children: [] })
const tree = (path, branch, isMain = false) => ({ path, branch: `refs/heads/${branch}`, head: 'a'.repeat(40), isMain, dispatched: false, dirty: false, setupJob: null })
const parent = (session_id, cwd, status, waiting_for = null) => ({ session_id, pid: 1, name: null, status, cwd, waiting_for })

const TREES = {
  [REPO]: [
    tree(REPO, 'main', true),
    tree(`${REPO}-wt-jump-palette`, 'feat/orca-redesign-b/jump-palette'),
    tree(`${REPO}-wt-left-sidebar`, 'feat/orca-redesign-b/left-sidebar'),
    tree(`${REPO}-wt-status-bar`, 'feat/orca-redesign-b/status-bar'),
  ],
  [SITE]: [tree(SITE, 'main', true), tree(`${SITE}-wt-blog-redesign`, 'blog-redesign')],
}

scenario('jump-palette', {
  ipc: appIpc({
    home_snapshot: { repos: [repo(REPO, 'mnemo-desktop'), repo(SITE, 'website')], clone_base: `${HOME}/code`, errors: [], protected: 0 },
    worktree_list: ({ repo: root }) => TREES[root] ?? [],
    mission_snapshot: () => ({
      repos: [
        {
          root: REPO,
          name: 'mnemo-desktop',
          parents: [
            parent('11111111-aaaa', `${REPO}-wt-jump-palette`, 'busy'),
            parent('22222222-bbbb', `${REPO}-wt-left-sidebar`, 'waiting', 'permission prompt'),
            parent('33333333-cccc', `${SITE}-wt-blog-redesign`, 'idle'),
          ],
          missions: [],
          children: [],
        },
      ],
      errors: [],
      at: new Date().toISOString(),
    }),
  }),
  // What the native menu sends for Mod+J; the fleet has loaded by then.
  events: [{ event: 'app://action', payload: { id: 'worktree.jump' }, afterMs: 1500 }],
})
