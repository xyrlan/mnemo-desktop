// The diff tab on a workspace's uncommitted changes: three files changed, one of them new, a
// Claude session running in the tree's terminal (who the notes go to), and the first file's diff
// side by side in Monaco. Notes live in the page's localStorage, so a shot of cards needs one
// seeded (`mnemo-desktop.diff-comments`) before the page loads; this scenario shows the tab as
// it opens.
import { scenario } from '../scenario.mjs'
import { appIpc, REPO } from '../fixtures/app.mjs'
import { TERMINAL_OUTPUT } from '../fixtures/terminal-output.mjs'

const WT = `${REPO}-wt-diff-comments`
const SESSION = 'd1ff0c0m-0000-4000-8000-000000000001'
const at = Date.parse('2026-09-24T12:00:00Z')

const tree = (path, branch, more = {}) => ({ path, branch, head: 'a'.repeat(40), isMain: false, dispatched: false, dirty: true, setupJob: null, ...more })

const ORIGINAL = `import { invoke } from '@tauri-apps/api/core'

/** One worktree of a repo, as \`worktree.rs\` reports it. */
export type WorktreeInfo = {
  path: string
  branch: string | null
  head: string
}

export const listWorktrees = (repo: string): Promise<WorktreeInfo[]> =>
  invoke<WorktreeInfo[]>('worktree_list', { repo })

export const removeWorktree = (path: string): Promise<void> =>
  invoke<void>('worktree_remove', { path })
`

const MODIFIED = `import { invoke } from '@tauri-apps/api/core'

/** One worktree of a repo, as \`worktree.rs\` reports it. */
export type WorktreeInfo = {
  path: string
  /** null on a detached HEAD. */
  branch: string | null
  head: string
  dirty: boolean
}

export const listWorktrees = (repo: string): Promise<WorktreeInfo[]> =>
  invoke<WorktreeInfo[]>('worktree_list', { repo })

/** Removes a worktree, keeping its branch; \`force\` for a dirty tree. */
export const removeWorktree = (path: string, force = false): Promise<void> =>
  invoke<void>('worktree_remove', { path, force })
`

const FILES = [
  { path: 'src/worktrees/client.ts', oldPath: null, status: 'modified', additions: 5, deletions: 2, binary: false },
  { path: 'src/worktrees/archive.ts', oldPath: null, status: 'untracked', additions: 42, deletions: 0, binary: false },
  { path: 'docs/cleanup.md', oldPath: null, status: 'deleted', additions: 0, deletions: 12, binary: false },
]

scenario('diff-comments', {
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
          sessions: [{ id: SESSION, title: 'Archive stale worktrees', cwd: WT, last_at: at, transcript: true, live: 'here', kind: 'interactive', agent: null }],
          children: [],
        },
      ],
      clone_base: '/Users/preview/code',
      errors: [],
      protected: 0,
    },
    worktree_list: ({ repo }) => (repo === REPO ? [tree(REPO, 'main', { isMain: true, dirty: false }), tree(WT, 'feat/archive-worktrees')] : []),
    mission_looked: {},
    workspace_read: {
      version: 2,
      activeWorktree: WT,
      worktrees: [
        {
          path: WT,
          tabs: [
            { id: 'tab-1', root: { kind: 'leaf', pane: 1 }, focused: 1 },
            { id: 'tab-2', root: { kind: 'leaf', pane: 2 }, focused: 2 },
          ],
          panes: {
            1: { view: 'terminal', cwd: WT, sessionId: SESSION },
            2: { view: 'diff', props: { worktree: WT }, title: 'Changes' },
          },
          activeTab: 'tab-2',
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
    chrome_branch: 'feat/archive-worktrees',
    worktree_diff_files: ({ worktree }) => {
      if (worktree !== WT) throw new Error(`worktree_diff_files asked for ${worktree}`)
      return { root: WT, files: FILES, truncated: false }
    },
    worktree_diff_file: ({ file }) => {
      if (file === 'src/worktrees/client.ts') return { original: ORIGINAL, modified: MODIFIED, binary: false, tooLarge: false }
      if (file === 'docs/cleanup.md') return { original: '# Cleanup\n\nStale worktrees are removed by hand.\n', modified: '', binary: false, tooLarge: false }
      return { original: '', modified: '// the cleanup view\nexport {}\n', binary: false, tooLarge: false }
    },
  }),
})
