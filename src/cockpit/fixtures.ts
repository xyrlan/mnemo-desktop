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
