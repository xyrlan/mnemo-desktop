import { expect, test } from 'vitest'
import { GREEN, MACOS, PR, TAIL, UBUNTU, VERCEL, VIEW, WINDOWS, WINDOWS_DETAILS, check } from './fixtures'
import {
  commentPrompt,
  countChecks,
  detailsKey,
  fixPrompt,
  mergeBlock,
  pollDelay,
  POLL_IDLE_MS,
  POLL_RUNNING_MS,
  PROMPT_LOG_BUDGET,
  relativeTime,
  statusLabel,
  tailOf,
  threadPrompt,
} from './model'

test('checks count by verdict, the rule the rest of the app reads CI by', () => {
  expect(countChecks(VIEW.checks)).toEqual({ passing: 2, failing: 1, pending: 1 })
  expect(countChecks([])).toEqual({ passing: 0, failing: 0, pending: 0 })
})

test('a check says where it stands in Orca’s words', () => {
  expect(statusLabel(WINDOWS)).toBe('Failed')
  expect(statusLabel(UBUNTU)).toBe('In progress')
  expect(statusLabel(check({ status: 'queued', conclusion: null }))).toBe('Queued')
  expect(statusLabel(check({ status: 'pending', conclusion: null }))).toBe('Pending')
  expect(statusLabel(MACOS)).toBe('Successful')
  expect(statusLabel(check({ conclusion: 'timed_out' }))).toBe('Timed out')
  expect(statusLabel(check({ conclusion: 'action_required' }))).toBe('Action required')
  expect(statusLabel(check({ conclusion: 'skipped' }))).toBe('Skipped')
})

test('a merge is offered only for an open, conflict-free PR whose every check passed', () => {
  expect(mergeBlock(PR, GREEN.checks)).toBeNull()
  expect(mergeBlock(PR, VIEW.checks)).toBe('1 check failing')
  expect(mergeBlock(PR, [MACOS, UBUNTU])).toBe('1 check still running')
  expect(mergeBlock(PR, [])).toBe('No checks ran on its head, so nothing says it is green')
  expect(mergeBlock({ ...PR, state: 'draft' }, GREEN.checks)).toBe('A draft: mark it ready for review first')
  expect(mergeBlock({ ...PR, mergeable: 'CONFLICTING' }, GREEN.checks)).toBe('It conflicts with main: resolve that first')
  expect(mergeBlock({ ...PR, state: 'merged' }, GREEN.checks)).toBe('Already merged')
  expect(mergeBlock({ ...PR, state: 'closed' }, GREEN.checks)).toBe('The pull request is closed')
})

test('the tab reads again sooner while a check runs, and slowly once nothing will change', () => {
  expect(pollDelay(VIEW)).toBe(POLL_RUNNING_MS)
  expect(pollDelay(GREEN)).toBe(POLL_IDLE_MS)
  expect(pollDelay({ ...VIEW, pr: { ...PR, state: 'merged' } })).toBe(POLL_IDLE_MS)
  expect(pollDelay(null)).toBe(POLL_IDLE_MS)
  expect(pollDelay({ ...VIEW, pr: null, checks: [] })).toBe(POLL_IDLE_MS)
})

test('a check is read again once its state changes', () => {
  expect(detailsKey(UBUNTU)).not.toBe(detailsKey({ ...UBUNTU, status: 'completed', conclusion: 'failure' }))
  expect(detailsKey(WINDOWS)).toBe(detailsKey({ ...WINDOWS }))
})

test('times read relative to now', () => {
  const now = Date.parse('2026-09-24T18:00:00Z')
  expect(relativeTime('2026-09-24T17:59:30Z', now)).toBe('just now')
  expect(relativeTime('2026-09-24T17:55:00Z', now)).toBe('5m ago')
  expect(relativeTime('2026-09-24T15:00:00Z', now)).toBe('3h ago')
  expect(relativeTime('2026-09-21T18:00:00Z', now)).toBe('3d ago')
  expect(relativeTime('nope', now)).toBe('')
  expect(relativeTime('2025-06-15T12:00:00Z', now)).toMatch(/2025/)
})

test('a tail keeps the end, starting on a whole line', () => {
  expect(tailOf('abc', 10)).toBe('abc')
  expect(tailOf('one\ntwo\nthree', 9)).toBe('three')
})

test('Fix’s prompt carries each failing check with its failed step, annotations and log', () => {
  const text = fixPrompt(PR, [{ check: WINDOWS, details: WINDOWS_DETAILS }])
  expect(text).toMatch(/^The CI checks of pull request #240 \(feat\/checks → main\) are failing: test \(windows-latest\)\./)
  expect(text).toContain('fix it in this worktree')
  expect(text).toContain('commit and push')
  expect(text).toContain('## test (windows-latest): failed')
  expect(text).toContain('Link: https://github.com/o/app/actions/runs/36/job/103')
  expect(text).toContain('Failed step: Run cargo test --manifest-path src-tauri/Cargo.toml')
  expect(text).toContain('- .github:445 (failure) Process completed with exit code 1.')
  expect(text).toContain('- .github:7 (warning) Node.js 20 is deprecated.')
  expect(text).toContain(['Log tail:', '```text', TAIL, '```'].join('\n'))
  expect(text).toContain('Full log: gh run view --job 103 --log-failed')
  expect(text).not.toContain('Run pnpm build')
})

test('Fix’s prompt says what it could not read, and bounds the logs it carries', () => {
  const external = check({ name: 'buildkite', verdict: 'fail', conclusion: 'failure', url: 'https://buildkite.com/x', description: 'Build #9 failed' })
  const text = fixPrompt(PR, [
    { check: WINDOWS, details: null, error: 'gh: Not Found (HTTP 404)' },
    { check: external, details: null },
    { check: { ...WINDOWS, name: 'lint', jobId: 104 }, details: { ...WINDOWS_DETAILS, logTail: null, logError: 'log expired' } },
  ])
  expect(text).toContain('Its job could not be read (gh: Not Found (HTTP 404)).')
  expect(text).toContain('Says: Build #9 failed')
  expect(text).toContain('It did not run on GitHub Actions')
  expect(text).not.toContain('gh run view --job undefined')
  expect(text).toContain('Its log could not be read (log expired).')

  const long = Array.from({ length: 4000 }, (_, i) => `line ${i}`).join('\n')
  const big = fixPrompt(PR, [
    { check: WINDOWS, details: { ...WINDOWS_DETAILS, logTail: long } },
    { check: { ...WINDOWS, name: 'lint', jobId: 104 }, details: { ...WINDOWS_DETAILS, logTail: long } },
  ])
  expect(big.length).toBeLessThan(PROMPT_LOG_BUDGET + 2_000)
  expect(big).toContain('line 3999\n```')
})

test('a review thread goes with where it is, its code and every reply', () => {
  const text = threadPrompt(PR, VIEW.threads[0])
  expect(text).toMatch(/^A review comment on pull request #240 \(feat\/checks → main\), on src-tauri\/src\/checks\.rs:42:/)
  expect(text).toContain('```diff\n+fn gh(args: &[&str]) -> String {')
  expect(text).toContain('@octo-reviewer: This runs `gh` with no timeout')
  expect(text).toContain('@xyrlan: Good catch, will add one.')
  expect(text).toContain('Address it in this worktree. (https://github.com/o/app/pull/240#discussion_r1)')
  expect(threadPrompt(PR, VIEW.threads[1])).toContain('on src/checks/model.ts:12 (the code has changed since):')
})

test('a comment or a review goes with who wrote it', () => {
  expect(commentPrompt(PR, VIEW.comments[0])).toBe(
    'A review of pull request #240 (feat/checks → main) by @octo-reviewer (changes requested):\n\nTwo things before this lands, inline.\n\nAddress it in this worktree.',
  )
  expect(commentPrompt(PR, VIEW.comments[1])).toBe(
    'A comment on pull request #240 (feat/checks → main) by @octo-reviewer:\n\nDoes this still build on Windows?\n\nAddress it in this worktree. (https://github.com/o/app/pull/240#issuecomment-1)',
  )
  expect(VERCEL.jobId).toBeNull()
})
