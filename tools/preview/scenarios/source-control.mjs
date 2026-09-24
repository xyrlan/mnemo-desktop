// The right sidebar on its Source Control tab: a workspace mid-change, with a rename staged, two
// files changed (one deleted), two new files and a conflict left from a merge. The tab is picked
// by running `source-control.show`, as the palette would.
import { scenario } from '../scenario.mjs'
import { appIpc, REPO } from '../fixtures/app.mjs'
import { TERMINAL_OUTPUT } from '../fixtures/terminal-output.mjs'

const WT = `${REPO}-wt-source-control`
const SESSION = '5c0e7a11-0000-4000-8000-000000000001'
const at = Date.parse('2026-09-24T12:00:00Z')

const tree = (path, branch, more = {}) => ({ path, branch, head: 'a'.repeat(40), isMain: false, dispatched: false, dirty: true, setupJob: null, ...more })
const entry = (path, area, status, added = null, removed = null, oldPath = null) => ({ path, oldPath, area, status, added, removed })

const ENTRIES = [
  entry('src/fleet/model.ts', 'conflicted', 'conflicted'),
  entry('src/source-control/view.tsx', 'staged', 'renamed', 4, 1, 'src/scm/view.tsx'),
  entry('src/source-control/store.ts', 'staged', 'modified', 38, 6),
  entry('src/source-control/store.ts', 'unstaged', 'modified', 3, 1),
  entry('src/rightbar/RightSidebar.tsx', 'unstaged', 'modified', 12, 4),
  entry('docs/old-scm-notes.md', 'unstaged', 'deleted', 0, 27),
  entry('src/source-control/live.ts', 'untracked', 'untracked', 96, 0),
  entry('tools/preview/scenarios/source-control.mjs', 'untracked', 'untracked', 41, 0),
]

const FILES = [
  { path: 'src/fleet/model.ts', oldPath: null, status: 'conflicted', additions: 9, deletions: 2, binary: false },
  { path: 'src/source-control/view.tsx', oldPath: 'src/scm/view.tsx', status: 'renamed', additions: 4, deletions: 1, binary: false },
  { path: 'src/source-control/store.ts', oldPath: null, status: 'modified', additions: 41, deletions: 7, binary: false },
  { path: 'src/rightbar/RightSidebar.tsx', oldPath: null, status: 'modified', additions: 12, deletions: 4, binary: false },
  { path: 'docs/old-scm-notes.md', oldPath: null, status: 'deleted', additions: 0, deletions: 27, binary: false },
  { path: 'src/source-control/live.ts', oldPath: null, status: 'untracked', additions: 96, deletions: 0, binary: false },
  { path: 'tools/preview/scenarios/source-control.mjs', oldPath: null, status: 'untracked', additions: 41, deletions: 0, binary: false },
]

scenario('source-control', {
  ipc: appIpc({
    home_snapshot: {
      repos: [
        {
          root: REPO,
          name: 'mnemo-desktop',
          last_at: at,
          pinned: true,
          hidden: false,
          unresolved: false,
          sessions: [{ id: SESSION, title: 'Source control panel', cwd: WT, last_at: at, transcript: true, live: 'here', kind: 'interactive', agent: null }],
          children: [],
        },
      ],
      clone_base: '/Users/preview/code',
      errors: [],
      protected: 0,
    },
    worktree_list: ({ repo }) => (repo === REPO ? [tree(REPO, 'main', { isMain: true, dirty: false }), tree(WT, 'feat/source-control')] : []),
    mission_looked: {},
    workspace_read: {
      version: 2,
      activeWorktree: WT,
      worktrees: [
        {
          path: WT,
          tabs: [{ id: 'tab-1', root: { kind: 'leaf', pane: 1 }, focused: 1 }],
          panes: { 1: { view: 'terminal', cwd: WT, sessionId: SESSION } },
          activeTab: 'tab-1',
        },
      ],
    },
    workspace_live_sessions: [SESSION],
    pty_spawn: ({ onOutput }) => {
      setTimeout(() => void onOutput.sendBytes(TERMINAL_OUTPUT), 50)
      return 1
    },
    pty_write: null,
    pty_resize: null,
    pty_kill: null,
    pty_pid: 4242,
    pty_list: [],
    memory_feed: { project: 'mnemo-desktop', briefing: null, fired: [], learned: [], inbox: [] },
    chrome_repo: 'mnemo-desktop',
    chrome_branch: 'feat/source-control',
    source_control_status: ({ worktree }) => {
      if (worktree !== WT) throw new Error(`source_control_status asked for ${worktree}`)
      return { root: WT, branch: 'feat/source-control', entries: ENTRIES, truncated: false }
    },
    source_control_watch: null,
    source_control_stage: null,
    source_control_unstage: null,
    source_control_discard: null,
    worktree_diff_files: () => ({ root: WT, files: FILES, truncated: false }),
    worktree_diff_file: () => ({ original: 'export const a = 1\n', modified: 'export const a = 2\n', binary: false, tooLarge: false }),
  }),
  events: [{ event: 'app://action', payload: { id: 'source-control.show' }, afterMs: 600 }],
})
