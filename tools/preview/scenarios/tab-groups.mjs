// A split workbench (tab groups, wave 2): a terminal group beside an editor group, each with its
// own tab row. The terminal group is the one you are in: its row carries the accent and the
// editor group dims a little. The editor group shows a preview tab, in italics, after a kept one.
// The top-left row starts the window's top band after the left sidebar; the top-right row ends
// it with the titlebar's right cluster.
import { scenario } from '../scenario.mjs'
import { appIpc, REPO } from '../fixtures/app.mjs'
import { TERMINAL_OUTPUT } from '../fixtures/terminal-output.mjs'

const WORKING = 'a1b2c3d4-0000-4000-8000-000000000011'
const OPEN = `${REPO}/src/tab-group/layout.ts`

const SOURCE = `import type { GroupNode } from '../layout/store'
import { cutBox, FULL, type Box, type DividerBox } from '../chrome/geometry'

/** A group's tab row: as tall as the sidebars' headers. */
export const ROW_H = 36

export function groupLayout(root: GroupNode | null): GroupLayout {
  const out: GroupLayout = { groups: [], seams: [] }
  if (root) walk(root, FULL, [], ALL, out)
  return out
}
`

const leaf = (pane) => ({ kind: 'leaf', pane })
const d = (name) => ({ name, is_dir: true })
const f = (name) => ({ name, is_dir: false })

let next = 1

const ipc = appIpc({
  home_snapshot: {
    repos: [{ root: REPO, name: 'mnemo-desktop', last_at: 0, pinned: true, hidden: false, unresolved: false, sessions: [], children: [] }],
    clone_base: '/Users/preview/code',
    errors: [],
    protected: 0,
  },
  worktree_list: [{ path: REPO, branch: 'refs/heads/main', head: 'abc', isMain: true, dispatched: false, dirty: false, setupJob: null }],
  mission_looked: {},
  workspace_read: {
    version: 3,
    activeWorktree: REPO,
    worktrees: [
      {
        path: REPO,
        tabs: [
          { id: 'tab-1', root: leaf(1), focused: 1, name: 'tab groups' },
          { id: 'tab-2', root: leaf(2), focused: 2 },
          { id: 'tab-3', root: leaf(3), focused: 3 },
          { id: 'tab-4', root: leaf(4), focused: 4, preview: true },
        ],
        panes: {
          1: { view: 'terminal', cwd: REPO, sessionId: WORKING },
          2: { view: 'terminal', cwd: REPO },
          3: { view: 'editor', props: { path: `${REPO}/README.md`, root: REPO }, title: 'README.md' },
          4: { view: 'editor', props: { path: OPEN, root: REPO }, title: 'layout.ts' },
        },
        groups: {
          'group-1': { id: 'group-1', tabs: ['tab-1', 'tab-2'], activeTab: 'tab-1' },
          'group-2': { id: 'group-2', tabs: ['tab-3', 'tab-4'], activeTab: 'tab-4' },
        },
        groupRoot: { kind: 'split', dir: 'row', ratio: 0.55, children: [{ kind: 'group', group: 'group-1' }, { kind: 'group', group: 'group-2' }] },
        activeGroup: 'group-1',
        activeTab: 'tab-1',
      },
    ],
  },
  // Every session is live elsewhere, so the restore types no `claude --resume`.
  workspace_live_sessions: ({ ids }) => ids,
  pty_spawn: ({ onOutput }) => {
    setTimeout(() => void onOutput.sendBytes(TERMINAL_OUTPUT), 50)
    return next++
  },
  pty_write: null,
  pty_resize: null,
  pty_kill: null,
  pty_pid: 4242,
  chrome_repo: 'mnemo-desktop',
  chrome_branch: 'feat/tab-groups-view/workbench-groups',
  memory_feed: { project: 'mnemo-desktop', briefing: null, fired: [], learned: [], inbox: [] },
  fs_list: ({ dir }) => (dir === REPO ? [d('src'), f('README.md')] : dir === `${REPO}/src` ? [d('tab-group')] : [f('layout.ts')]),
  fs_read: ({ path }) => (path === OPEN ? SOURCE : '# mnemo-desktop\n'),
})
const working = { event: 'agent://event', payload: { sessionId: WORKING, cwd: REPO, kind: 'prompt', message: 'split the workbench', at: Date.now() + 60_000 }, afterMs: 900 }

scenario('tab-groups', { ipc, events: [working] })

// The same with both sidebars closed: the app's name and the left sidebar's toggle start the
// top-left group's row, and the right sidebar's toggle ends the top-right one's, after the cluster.
scenario('tab-groups-sidebars-closed', {
  ipc,
  events: [working, { event: 'app://action', payload: { id: 'sidebar.toggle-left' }, afterMs: 900 }, { event: 'app://action', payload: { id: 'sidebar.toggle-right' }, afterMs: 900 }],
})
