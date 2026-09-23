import { child, desktop, mnemo, notes } from '../mission/fixtures'
import type { RepoGroup, Snapshot } from '../mission/types'

/** The mission fixtures plus what only the cockpit reads: PRs with CI, a landable contract. */
export const shipped: RepoGroup = {
  root: '/Users/me/github/mnemo',
  name: 'mnemo',
  parents: mnemo.parents,
  children: mnemo.children,
  missions: [
    {
      feature: 'round4',
      contract_path: '/Users/me/github/mnemo/docs/contracts/round4.md',
      landable: true,
      pieces: [
        { name: 'api', branch: 'feat/round4/api', child: child({ id: 'beef0001', state: 'done', live: false, updated_at: new Date().toISOString() }), pr: { number: 12, url: 'https://github.com/me/mnemo/pull/12', state: 'OPEN', head: 'feat/round4/api', ci: 'pass' } },
        { name: 'docs', branch: 'feat/round4/docs', child: null, pr: { number: 13, url: 'https://github.com/me/mnemo/pull/13', state: 'OPEN', head: 'feat/round4/docs', ci: 'fail' } },
        { name: 'later', branch: 'feat/round4/later', child: null, pr: null },
      ],
    },
  ],
}

export const withPrs: Snapshot = { repos: [desktop, shipped, notes], errors: [], at: '2026-09-15T12:00:00Z' }

/** A contract delivered days ago: its PRs merged (one with a red last rollup, one closed red
 *  without merging), their head branches gone, nobody working on it. None of it needs you. */
export const merged: RepoGroup = {
  root: '/Users/me/github/mnemo-desktop',
  name: 'mnemo-desktop',
  parents: [],
  children: [],
  missions: [
    {
      feature: 'round3',
      contract_path: '/Users/me/github/mnemo-desktop/docs/contracts/round3.md',
      landable: false,
      pieces: [
        { name: 'vault', branch: 'feat/round3/vault', child: null, pr: { number: 27, url: 'https://github.com/me/mnemo-desktop/pull/27', state: 'MERGED', head: 'feat/round3/vault', ci: 'fail' } },
        { name: 'chrome', branch: 'feat/round3/chrome', child: null, pr: { number: 28, url: 'https://github.com/me/mnemo-desktop/pull/28', state: 'MERGED', head: 'feat/round3/chrome', ci: 'pass' } },
        { name: 'docs', branch: 'feat/round3/docs', child: null, pr: { number: 29, url: 'https://github.com/me/mnemo-desktop/pull/29', state: 'CLOSED', head: 'feat/round3/docs', ci: 'fail' } },
      ],
    },
  ],
}

/** Children dispatched by issue, outside any contract, each with the PR it opened: a red one
 *  (naming its red job), a green draft, a green one, a pending one and one already merged. #45's
 *  child finished days ago and its worktree is gone; its PR is still open. */
export const issuePrs: RepoGroup = {
  root: '/Users/me/github/mnemo-desktop',
  name: 'mnemo-desktop',
  parents: [],
  missions: [],
  children: [
    child({ id: 'i40', branch: 'fix/issue-40', cwd: '/Users/me/github/mnemo-desktop-wt-40', pr: { number: 50, url: 'https://github.com/me/mnemo-desktop/pull/50', state: 'OPEN', head: 'fix/issue-40', ci: 'fail', failing: ['test (windows-latest)'] } }),
    child({ id: 'i41', branch: 'fix/issue-41', cwd: '/Users/me/github/mnemo-desktop-wt-41', state: 'done', live: false, pr: { number: 49, url: 'https://github.com/me/mnemo-desktop/pull/49', state: 'OPEN', head: 'fix/issue-41', ci: 'pass', draft: true } }),
    child({ id: 'i42', branch: 'fix/issue-42', cwd: '/Users/me/github/mnemo-desktop-wt-42', pr: { number: 51, url: 'https://github.com/me/mnemo-desktop/pull/51', state: 'OPEN', head: 'fix/issue-42', ci: 'pass' } }),
    child({ id: 'i43', branch: 'fix/issue-43', cwd: '/Users/me/github/mnemo-desktop-wt-43', pr: { number: 52, url: 'https://github.com/me/mnemo-desktop/pull/52', state: 'OPEN', head: 'fix/issue-43', ci: 'pending' } }),
    child({ id: 'i44', branch: 'fix/issue-44', cwd: '/Users/me/github/mnemo-desktop-wt-44', state: 'done', live: false, pr: { number: 48, url: 'https://github.com/me/mnemo-desktop/pull/48', state: 'MERGED', head: 'fix/issue-44', ci: 'fail' } }),
    child({ id: 'i45', branch: null, cwd: '/Users/me/github/mnemo-desktop-wt-45', state: 'done', live: false, updated_at: '2026-09-01T00:00:00Z', pr: { number: 47, url: 'https://github.com/me/mnemo-desktop/pull/47', state: 'OPEN', head: 'fix/issue-45', ci: 'pass' } }),
  ],
}
