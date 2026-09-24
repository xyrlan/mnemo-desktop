// The right sidebar open on its Memory panel: a worktree on screen with a terminal running a
// Claude session, and a vault with a briefing, rules that fired in that session, pages mnemo
// learned for the project and two staged in its inbox.
import { scenario } from '../scenario.mjs'
import { appIpc, REPO } from '../fixtures/app.mjs'
import { TERMINAL_OUTPUT } from '../fixtures/terminal-output.mjs'

const SESSION = 'b7e1c2d4-0f3a-4c11-9e2d-5a6b7c8d9e0f'
// Relative to the shot, so the ages read the same whenever it is taken.
const ago = (ms) => Date.now() - ms
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

const FEED = {
  project: 'mnemo-desktop',
  briefing: {
    sessionId: 'ca38e28b-5db0-4a25-aed1-8a8f61998cf5',
    date: '2026-09-24',
    tldr: 'Built src/fleet/ — the model merging repos, worktrees and agent state from Home snapshots and agent hooks. Full suite passes; PR #186 open and ready for review.',
    path: '/Users/preview/mnemo/bots/mnemo-desktop/briefings/sessions/ca38e28b.md',
  },
  fired: [
    { slug: 'run-git-commands-yourself', name: 'Run git commands yourself', at: ago(2 * MIN), source: 'reflex' },
    { slug: 'fresh-worktree-needs-pnpm-install', name: 'Fresh worktree needs pnpm install', at: ago(9 * MIN), source: 'mcp' },
    { slug: 'pnpm-never-npm', name: 'pnpm, never npm', at: ago(14 * MIN), source: 'denial' },
    { slug: 'orca-redesign-underway', name: 'Orca redesign underway', at: ago(31 * MIN), source: 'reflex' },
  ],
  learned: [
    { slug: 'tauri-drop-position-is-webview-relative', name: 'Tauri drop position is webview-relative', at: ago(5 * HOUR) },
    { slug: 'react-virtuoso-draws-nothing-in-jsdom', name: 'react-virtuoso draws nothing in jsdom at the bottom', at: ago(1 * DAY) },
    { slug: 'vitest5-spy-rejecting-a-string', name: 'vitest 5 spy rejecting a string fails the test', at: ago(3 * DAY) },
  ],
  inbox: [
    {
      key: 'feedback/headless-shell-diffs-computed-styles',
      type: 'feedback',
      title: 'Headless shell diffs computed styles',
      excerpt: "Playwright's cached chrome-headless-shell --dump-dom works from a job; full Chrome hangs.",
    },
    {
      key: 'project/merge-green-prs-myself',
      type: 'project',
      title: 'Merge green PRs myself',
      excerpt: 'The parent merges mnemo-desktop PRs after 3-OS CI is green and the diff is read.',
    },
  ],
}

scenario('right-sidebar', {
  ipc: appIpc({
    home_snapshot: {
      repos: [{ root: REPO, name: 'mnemo-desktop', last_at: ago(HOUR), pinned: true, hidden: false, unresolved: false, sessions: [], children: [] }],
      clone_base: '/Users/preview/code',
      errors: [],
      protected: 0,
    },
    workspace_read: {
      version: 2,
      activeWorktree: REPO,
      worktrees: [
        {
          path: REPO,
          tabs: [{ id: 'tab-1', root: { kind: 'leaf', pane: 1 }, focused: 1 }],
          panes: { 1: { view: 'terminal', cwd: REPO, sessionId: SESSION } },
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
    chrome_repo: 'mnemo-desktop',
    chrome_branch: 'main',
    memory_feed: ({ cwd, sessionId }) => {
      if (cwd !== REPO || sessionId !== SESSION) throw new Error(`memory_feed asked for ${cwd} / ${sessionId}`)
      return FEED
    },
  }),
})
