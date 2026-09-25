// What `checks.rs` answers for a PR with one failing, one running and two passing checks, two
// review threads and two comments: the shapes of `src-tauri/fixtures/checks/`, for the tests.
import type { Check, CheckDetails, ChecksPr, ChecksView } from './client'

export const WT = '/code/app-wt-checks'

export const PR: ChecksPr = {
  number: 240,
  title: "feat(checks): Orca's Checks panel as a right-sidebar tab",
  url: 'https://github.com/o/app/pull/240',
  state: 'open',
  base: 'main',
  head: 'feat/checks',
  headSha: 'de92f99410241cdcb2de6aad015b0482e065943e',
  author: 'xyrlan',
  mergeable: 'MERGEABLE',
  mergeState: 'UNSTABLE',
  reviewDecision: 'CHANGES_REQUESTED',
  updatedAt: '2026-09-24T17:03:00Z',
  additions: 412,
  deletions: 37,
  changedFiles: 9,
}

export const check = (over: Partial<Check>): Check => ({
  name: 'test',
  workflow: 'ci',
  verdict: 'pass',
  status: 'completed',
  conclusion: 'success',
  url: null,
  description: null,
  startedAt: '2026-09-24T16:16:12Z',
  completedAt: '2026-09-24T16:18:19Z',
  jobId: null,
  ...over,
})

export const WINDOWS = check({
  name: 'test (windows-latest)',
  verdict: 'fail',
  conclusion: 'failure',
  url: 'https://github.com/o/app/actions/runs/36/job/103',
  jobId: 103,
})
export const UBUNTU = check({ name: 'test (ubuntu-latest)', verdict: 'pending', status: 'in_progress', conclusion: null, completedAt: null, url: 'https://github.com/o/app/actions/runs/36/job/102', jobId: 102 })
export const MACOS = check({ name: 'test (macos-latest)', url: 'https://github.com/o/app/actions/runs/36/job/101', jobId: 101 })
export const VERCEL = check({ name: 'vercel', workflow: null, description: 'Deployment has completed', url: 'https://vercel.com/o/app/abc', completedAt: null })

export const TAIL = [
  'test worktree::tests::create_list_and_remove_a_sibling_tree ... FAILED',
  'failures:',
  '    worktree::tests::create_list_and_remove_a_sibling_tree',
  'test result: FAILED. 280 passed; 2 failed; 10 ignored',
  'error: test failed, to rerun pass `--lib`',
  '##[error]Process completed with exit code 1.',
].join('\n')

export const WINDOWS_DETAILS: CheckDetails = {
  jobId: 103,
  name: 'test (windows-latest)',
  status: 'completed',
  conclusion: 'failure',
  url: WINDOWS.url,
  startedAt: '2026-09-24T16:16:12Z',
  completedAt: '2026-09-24T16:23:41Z',
  steps: [
    { number: 10, name: 'Run pnpm build', status: 'completed', conclusion: 'success' },
    { number: 11, name: 'Run cargo test --manifest-path src-tauri/Cargo.toml', status: 'completed', conclusion: 'failure' },
    { number: 12, name: 'Run pnpm tauri build', status: 'completed', conclusion: 'skipped' },
  ],
  annotations: [
    { path: '.github', line: 445, level: 'failure', title: null, message: 'Process completed with exit code 1.' },
    { path: '.github', line: 7, level: 'warning', title: null, message: 'Node.js 20 is deprecated.' },
  ],
  logTail: TAIL,
  logError: null,
}

export const VIEW: ChecksView = {
  root: WT,
  branch: 'feat/checks',
  pr: PR,
  checks: [WINDOWS, UBUNTU, MACOS, VERCEL],
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
          createdAt: '2026-09-24T16:58:10Z',
          url: 'https://github.com/o/app/pull/240#discussion_r1',
          review: null,
          diffHunk: '+fn gh(args: &[&str]) -> String {\n+    let out = crate::proc::command("gh")',
        },
        { author: 'xyrlan', body: 'Good catch, will add one.', createdAt: '2026-09-24T17:00:00Z', url: null, review: null, diffHunk: null },
      ],
    },
    {
      id: 'PRRT_2',
      path: 'src/checks/model.ts',
      line: 12,
      resolved: true,
      outdated: true,
      comments: [{ author: 'ghost', body: 'Typo in the label.', createdAt: '2026-09-24T16:57:00Z', url: null, review: null, diffHunk: null }],
    },
  ],
  comments: [
    { author: 'octo-reviewer', body: 'Two things before this lands, inline.', createdAt: '2026-09-24T16:58:40Z', url: null, review: 'CHANGES_REQUESTED', diffHunk: null },
    { author: 'octo-reviewer', body: 'Does this still build on Windows?', createdAt: '2026-09-24T17:02:11Z', url: 'https://github.com/o/app/pull/240#issuecomment-1', review: null, diffHunk: null },
  ],
  threadsError: null,
  mergeMethods: ['squash', 'merge', 'rebase'],
}

/** The same PR once every check has passed. */
export const GREEN: ChecksView = { ...VIEW, checks: [MACOS, { ...UBUNTU, verdict: 'pass', status: 'completed', conclusion: 'success' }, VERCEL] }
