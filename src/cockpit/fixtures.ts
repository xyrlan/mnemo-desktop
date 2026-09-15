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
