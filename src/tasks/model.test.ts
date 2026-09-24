import { checksOf, dispatchable, taskRepos, totals } from './model'
import { EMPTY, type HomeRepo, type HomeSnapshot, type Pr } from '../home/types'
import { issue } from '../github/fixtures'
import type { IssueLink } from '../github/types'

const repo = (name: string, over: Partial<HomeRepo> = {}): HomeRepo => ({
  root: `/Users/me/github/${name}`,
  name,
  last_at: 0,
  pinned: false,
  hidden: false,
  unresolved: false,
  sessions: [],
  children: [],
  ...over,
})
const pr = (number: number, over: Partial<Pr> = {}): Pr => ({ number, title: `pr ${number}`, state: 'open', checks: 'none', child: null, url: `https://github.com/me/x/pull/${number}`, ...over })

const snap: HomeSnapshot = {
  ...EMPTY,
  repos: [
    repo('mnemo', { issues: [issue({ number: 1, title: 'Fix the tail', labels: ['bug'] }), issue({ number: 12, title: 'Sidebar cards' })], prs: [pr(7, { title: 'docs: tail' })] }),
    repo('quiet'),
    repo('secret', { hidden: true, issues: [issue({ number: 3 })] }),
    repo('guarded', { unresolved: true, issues: [issue({ number: 4 })] }),
    repo('broken'),
  ],
  errors: ['github (broken): gh: not logged in'],
}

test('lists the repos with something to show, in Home order, never hidden or unresolved ones', () => {
  const out = taskRepos(snap, '')
  expect(out.map((g) => g.repo.name)).toEqual(['mnemo', 'broken'])
  expect(out[0].issues.map((i) => i.number)).toEqual([1, 12])
  expect(out[0].prs.map((p) => p.number)).toEqual([7])
  expect(out[1]).toMatchObject({ issues: [], prs: [], error: 'gh: not logged in' })
  expect(out[0].error).toBeNull()
})

test('a query keeps items where every term is in the number, title, labels or repo name', () => {
  const pick = (q: string) => taskRepos(snap, q).map((g) => [g.repo.name, ...g.issues.map((i) => `#${i.number}`), ...g.prs.map((p) => `!${p.number}`)])
  expect(pick('tail')).toEqual([['mnemo', '#1', '!7']])
  expect(pick('#12')).toEqual([['mnemo', '#12']])
  expect(pick('BUG tail')).toEqual([['mnemo', '#1']])
  expect(pick('mnemo sidebar')).toEqual([['mnemo', '#12']])
  // A repo shown only for its error drops out under a query.
  expect(pick('nothing-like-this')).toEqual([])
})

test('totals counts what Tasks can list', () => {
  expect(totals(snap)).toEqual({ issues: 2, prs: 1 })
})

test('an issue something already works on is not dispatchable', () => {
  const links = new Map<number, IssueLink>([[12, { children: [], pieces: [], prs: [], closing: [7] }]])
  expect(dispatchable(snap.repos[0].issues!, links)).toEqual([1])
})

test('checks read as a tone and words', () => {
  expect(checksOf(pr(1, { checks: 'pass' }))).toEqual({ tone: 'pass', label: 'checks pass' })
  expect(checksOf(pr(1, { checks: 'fail' }))?.tone).toBe('fail')
  expect(checksOf(pr(1, { checks: 'pending' }))?.tone).toBe('pending')
  expect(checksOf(pr(1))).toBeNull()
})
