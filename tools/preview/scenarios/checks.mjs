// The right sidebar on its Checks tab: a workspace whose PR has a failing Windows job, a running
// Ubuntu one, two passing checks, review comments and changes requested. The tab is picked by
// running `checks.show`, as the palette would. `checks-no-pr` is the same workspace before its
// branch has a pull request.
import { scenario } from '../scenario.mjs'
import { appIpc, REPO } from '../fixtures/app.mjs'
import { TERMINAL_OUTPUT } from '../fixtures/terminal-output.mjs'

const WT = `${REPO}-wt-checks`
const BRANCH = 'feat/orca-redesign-e/checks'
const SESSION = 'c4ec5000-0000-4000-8000-000000000001'
const at = Date.parse('2026-09-24T12:00:00Z')
const iso = (minutesAgo) => new Date(Date.now() - minutesAgo * 60_000).toISOString()
const job = (id) => `https://github.com/xyrlan/mnemo-desktop/actions/runs/36026166545/job/${id}`

const check = (over) => ({
  name: 'test',
  workflow: 'ci',
  verdict: 'pass',
  status: 'completed',
  conclusion: 'success',
  url: null,
  description: null,
  startedAt: iso(40),
  completedAt: iso(30),
  jobId: null,
  ...over,
})

const PR = {
  number: 240,
  title: "feat(checks): Orca's Checks panel as a right-sidebar tab (orca-redesign-e)",
  url: 'https://github.com/xyrlan/mnemo-desktop/pull/240',
  state: 'open',
  base: 'main',
  head: BRANCH,
  headSha: 'de92f99410241cdcb2de6aad015b0482e065943e',
  author: 'xyrlan',
  mergeable: 'MERGEABLE',
  mergeState: 'UNSTABLE',
  reviewDecision: 'CHANGES_REQUESTED',
  updatedAt: iso(7),
  additions: 412,
  deletions: 37,
  changedFiles: 9,
}

const VIEW = {
  root: WT,
  branch: BRANCH,
  pr: PR,
  checks: [
    check({ name: 'test (windows-latest)', verdict: 'fail', conclusion: 'failure', url: job(107723124603), jobId: 107723124603 }),
    check({ name: 'test (ubuntu-latest)', verdict: 'pending', status: 'in_progress', conclusion: null, completedAt: null, url: job(107723125082), jobId: 107723125082 }),
    check({ name: 'test (macos-latest)', url: job(107723124824), jobId: 107723124824 }),
    check({ name: 'vercel', workflow: null, description: 'Deployment has completed', url: 'https://vercel.com/xyrlan/mnemo/abc', completedAt: null }),
  ],
  threads: [
    {
      id: 'PRRT_1',
      path: 'src-tauri/src/checks.rs',
      line: 42,
      resolved: false,
      outdated: false,
      comments: [
        {
          author: 'octo-reviewer',
          body: 'This runs `gh` with no timeout: a hung network call freezes the tab.',
          createdAt: iso(70),
          url: 'https://github.com/xyrlan/mnemo-desktop/pull/240#discussion_r1',
          review: null,
          diffHunk: '+fn gh(args: &[&str]) -> String {\n+    let out = crate::proc::command("gh")\n+        .args(args)\n+        .output()',
        },
        { author: 'xyrlan', body: 'Good catch, will add one.', createdAt: iso(66), url: null, review: null, diffHunk: null },
      ],
    },
    {
      id: 'PRRT_2',
      path: 'src/checks/model.ts',
      line: 12,
      resolved: true,
      outdated: true,
      comments: [{ author: 'octo-reviewer', body: 'Typo in the label.', createdAt: iso(72), url: null, review: null, diffHunk: null }],
    },
  ],
  comments: [
    { author: 'octo-reviewer', body: 'Two things before this lands, inline.', createdAt: iso(69), url: null, review: 'CHANGES_REQUESTED', diffHunk: null },
    { author: 'octo-reviewer', body: 'Does this still build on Windows? The last run failed there.', createdAt: iso(8), url: null, review: null, diffHunk: null },
  ],
  threadsError: null,
  mergeMethods: ['squash', 'merge', 'rebase'],
}

const TAIL = [
  'failures:',
  '',
  '---- worktree::tests::create_list_and_remove_a_sibling_tree stdout ----',
  "thread 'worktree::tests::create_list_and_remove_a_sibling_tree' panicked at src\\worktree.rs:377:9:",
  'assertion `left == right` failed',
  '  left: "C:/Users/runneradmin/AppData/Local/Temp/mnemo-test-wt-cycle/repo-wt-task"',
  ' right: "\\\\?\\C:\\Users\\runneradmin\\AppData\\Local\\Temp\\mnemo-test-wt-cycle\\repo-wt-task"',
  '',
  'failures:',
  '    worktree::tests::create_list_and_remove_a_sibling_tree',
  '    worktree::tests::remove_refuses_main_strangers_and_paths_outside_the_parent',
  '',
  'test result: FAILED. 280 passed; 2 failed; 10 ignored; 0 measured; 0 filtered out; finished in 24.09s',
  '',
  'error: test failed, to rerun pass `--lib`',
  '##[error]Process completed with exit code 1.',
].join('\n')

const DETAILS = {
  jobId: 107723124603,
  name: 'test (windows-latest)',
  status: 'completed',
  conclusion: 'failure',
  url: job(107723124603),
  startedAt: iso(40),
  completedAt: iso(30),
  steps: [
    { number: 10, name: 'Run pnpm build', status: 'completed', conclusion: 'success' },
    { number: 11, name: 'Run cargo test --manifest-path src-tauri/Cargo.toml', status: 'completed', conclusion: 'failure' },
  ],
  annotations: [
    { path: '.github', line: 445, level: 'failure', title: null, message: 'Process completed with exit code 1.' },
    { path: '.github', line: 7, level: 'warning', title: null, message: 'Node.js 20 is deprecated.' },
  ],
  logTail: TAIL,
  logError: null,
}

function ipc(view) {
  return appIpc({
    home_snapshot: {
      repos: [
        {
          root: REPO,
          name: 'mnemo-desktop',
          last_at: at,
          pinned: true,
          hidden: false,
          unresolved: false,
          sessions: [{ id: SESSION, title: 'Checks panel', cwd: WT, last_at: at, transcript: true, live: 'here', kind: 'interactive', agent: null }],
          children: [],
        },
      ],
      clone_base: '/Users/preview/code',
      errors: [],
      protected: 0,
    },
    worktree_list: ({ repo }) =>
      repo === REPO
        ? [
            { path: REPO, branch: 'main', head: 'a'.repeat(40), isMain: true, dispatched: false, dirty: false, setupJob: null },
            { path: WT, branch: BRANCH, head: 'b'.repeat(40), isMain: false, dispatched: false, dirty: false, setupJob: null },
          ]
        : [],
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
    chrome_branch: BRANCH,
    checks_read: ({ worktree }) => {
      if (worktree !== WT) throw new Error(`checks_read asked for ${worktree}`)
      return view
    },
    checks_details: ({ url }) => {
      if (url === DETAILS.url) return DETAILS
      throw new Error('gh: Not Found (HTTP 404)')
    },
    checks_merge: () => ({ merged: false, message: 'preview: nothing merged' }),
    checks_ready: null,
  })
}

const show = [{ event: 'app://action', payload: { id: 'checks.show' }, afterMs: 600 }]

scenario('checks', { ipc: ipc(VIEW), events: show })
scenario('checks-no-pr', { ipc: ipc({ ...VIEW, pr: null, checks: [], threads: [], comments: [] }), events: show })
