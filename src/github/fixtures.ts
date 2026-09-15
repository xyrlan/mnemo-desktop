import { withPrs, shipped } from '../cockpit/fixtures'
import type { RepoGroup, Snapshot } from '../mission/types'
import type { Board, Issue } from './types'

/** Issues of the `mnemo` repo in the cockpit fixtures: some already worked on, a dozen not. */
export function issue(over: Partial<Issue> & { number: number }): Issue {
  return {
    title: `issue ${over.number}`, labels: [], assignees: [], state: 'OPEN', url: `https://github.com/me/mnemo/issues/${over.number}`,
    updated_at: `2026-09-01T00:00:${String(over.number % 60).padStart(2, '0')}Z`, milestone: null, prs: [], pieces: [],
    ...over,
  }
}

/** `shipped` with its loose child on the branch `mnemo dispatch 40` creates. */
export const shippedOnIssue: RepoGroup = { ...shipped, children: shipped.children.map((c) => ({ ...c, branch: 'fix/issue-40' })) }
export const snapWithIssues: Snapshot = { ...withPrs, repos: withPrs.repos.map((r) => (r.root === shipped.root ? shippedOnIssue : r)) }

export const mnemoIssues: Issue[] = [
  issue({ number: 40, title: 'dispatched issue', updated_at: '2026-08-01T00:00:00Z' }),
  issue({ number: 41, title: 'contract api piece', pieces: [{ contract_path: shipped.missions[0].contract_path, piece: 'api' }], updated_at: '2026-08-02T00:00:00Z' }),
  issue({ number: 42, title: 'closed by the docs PR', prs: [13], updated_at: '2026-08-03T00:00:00Z' }),
  issue({ number: 43, title: 'closed by a PR the snapshot lacks', prs: [99], updated_at: '2026-08-04T00:00:00Z' }),
  ...Array.from({ length: 12 }, (_, i) => issue({ number: i + 1, labels: [i % 2 ? 'ui' : 'bug'], assignees: i === 11 ? ['me'] : [] })),
]

export const board: Board = {
  title: 'mnemo',
  url: 'https://github.com/users/me/projects/4',
  columns: [
    { name: 'Todo', items: [{ id: 'I1', title: 'issue 1', number: 1, url: 'https://github.com/me/mnemo/issues/1', kind: 'Issue' }] },
    {
      name: 'In Progress',
      items: [
        { id: 'I40', title: 'dispatched issue', number: 40, url: 'https://github.com/me/mnemo/issues/40', kind: 'Issue' },
        { id: 'P13', title: 'docs', number: 13, url: 'https://github.com/me/mnemo/pull/13', kind: 'PullRequest' },
      ],
    },
    { name: 'Done', items: [{ id: 'D1', title: 'someday', number: null, url: null, kind: 'DraftIssue' }] },
  ],
}
