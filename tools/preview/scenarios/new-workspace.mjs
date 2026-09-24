// The new-workspace composer (Mod+N), opened over the app through the native menu's action event,
// with two projects in the fleet: the one on screen preselected, its setup command remembered.
import { scenario } from '../scenario.mjs'
import { appIpc, HOME, REPO } from '../fixtures/app.mjs'

const NOTES = `${HOME}/code/field-notes`
const repo = (root, name, last_at) => ({ root, name, last_at, pinned: false, hidden: false, unresolved: false, sessions: [], children: [] })
const tree = (path, branch, isMain) => ({ path, branch, head: 'a'.repeat(40), isMain, dispatched: false, dirty: false, setupJob: null })

scenario('new-workspace', {
  ipc: appIpc({
    settings_read: { repoSetup: { [REPO]: 'pnpm install' } },
    home_snapshot: { repos: [repo(REPO, 'mnemo-desktop', 1758700000), repo(NOTES, 'field-notes', 1758600000)], clone_base: `${HOME}/code`, errors: [], protected: 0 },
    worktree_list: ({ repo: root }) =>
      root === REPO ? [tree(REPO, 'main', true), tree(`${REPO}-wt-workspace-1`, 'workspace-1', false)] : [tree(NOTES, 'trunk', true)],
  }),
  events: [{ event: 'app://action', payload: { id: 'workspace.new' }, afterMs: 1500 }],
})
