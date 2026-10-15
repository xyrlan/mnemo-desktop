import { child } from '../../../mission/fixtures'
import type { Mission } from '../../../mission/types'
import type { HomeRepo } from '../../../home/types'
import type { IssueLink } from '../../../github/types'
import { contractFiles, contractPathError, initialRepo, jobLine, missionOf, pick, robotOf, shortPath } from './model'

const repo = (root: string): HomeRepo => ({ root, name: root.split(/[\\/]/).pop()!, last_at: 0, pinned: false, hidden: false, unresolved: false, sessions: [], children: [] })
const link = (over: Partial<IssueLink>): IssueLink => ({ children: [], pieces: [], prs: [], closing: [], ...over })
const mission = (contract_path: string): Mission => ({ feature: 'round', contract_path, pieces: [], landable: false })

test('initialRepo finds the repo root names, compared as paths, else every repo', () => {
  const repos = [repo('/Users/me/github/mnemo'), repo('C:\\Users\\me\\notes')]
  expect(initialRepo(repos, '/Users/me/github/mnemo/')).toBe('/Users/me/github/mnemo')
  expect(initialRepo(repos, 'c:/Users/me/notes')).toBe('C:\\Users\\me\\notes')
  expect(initialRepo(repos, '/Users/me/elsewhere')).toBeNull()
  expect(initialRepo(repos, undefined)).toBeNull()
})

test('robotOf links to the live child first, else the newest, and to none for a PR alone', () => {
  const old = child({ id: 'aaaa0001', live: false, updated_at: '2026-10-01T00:00:00Z' })
  const newer = child({ id: 'aaaa0002', live: false, updated_at: '2026-10-02T00:00:00Z' })
  const live = child({ id: 'aaaa0003', live: true, updated_at: '2026-09-01T00:00:00Z' })
  expect(robotOf(link({ children: [old, newer] }))?.id).toBe('aaaa0002')
  const m = mission('/r/c.md')
  expect(robotOf(link({ children: [old], pieces: [{ mission: m, piece: { name: 'p', branch: 'b', child: live, pr: null } }] }))?.id).toBe('aaaa0003')
  expect(robotOf(link({ closing: [12] }))).toBeNull()
  expect(robotOf(undefined)).toBeNull()
})

test('pick toggles, and shift extends from the last pick through the dispatchable order', () => {
  const order = [1, 2, 3, 5]
  expect(pick([], order, 2, false)).toEqual([2])
  expect(pick([2], order, 2, false)).toEqual([])
  expect(pick([1], order, 5, true)).toEqual([1, 2, 3, 5])
  expect(pick([5], order, 2, true)).toEqual([5, 2, 3])
  // Shift with nothing picked, or onto an issue outside the order, is a plain toggle.
  expect(pick([], order, 3, true)).toEqual([3])
  expect(pick([1], order, 4, true)).toEqual([1, 4])
})

test('contractFiles keeps Markdown, newest name first, each with the mission dispatched from it', () => {
  const m = mission('/Users/me/github/mnemo/docs/contracts/round4.md')
  const files = contractFiles(
    '/Users/me/github/mnemo',
    [
      { dir: 'docs/superpowers/contracts', names: ['2026-10-01-a.md', 'README.txt', '2026-10-15-b.MD'] },
      { dir: 'docs/contracts', names: ['round4.md'] },
    ],
    [m],
  )
  expect(files.map((f) => f.path)).toEqual(['docs/contracts/round4.md', 'docs/superpowers/contracts/2026-10-15-b.MD', 'docs/superpowers/contracts/2026-10-01-a.md'])
  expect(files[0].mission).toBe(m)
  expect(files[1].mission).toBeNull()
})

test('missionOf compares the absolute contract path as a path, Windows too', () => {
  const m = mission('C:\\Users\\me\\repo\\docs\\c.md')
  expect(missionOf('C:\\Users\\me\\repo', 'docs/c.md', [m])).toBe(m)
  expect(missionOf('C:\\Users\\me\\repo', 'docs/d.md', [m])).toBeNull()
})

test('contractPathError takes a Markdown path inside the repo only', () => {
  expect(contractPathError('docs/superpowers/contracts/x.md')).toBeNull()
  expect(contractPathError('  ')).toBe('Name a contract.')
  expect(contractPathError('/abs/x.md')).toContain('inside the repo')
  expect(contractPathError('C:\\x.md')).toContain('inside the repo')
  expect(contractPathError('~/x.md')).toContain('inside the repo')
  expect(contractPathError('docs/../../x.md')).toContain('inside the repo')
  expect(contractPathError('docs/x.txt')).toContain('.md')
})

test('jobLine says how a dispatch stands', () => {
  expect(jobLine(undefined)).toEqual({ tone: 'run', text: 'starting…' })
  const lines = [{ line: 'queue: a1b2' }, { line: ' ' }] as never
  expect(jobLine({ title: 't', lines, running: true, code: null })).toEqual({ tone: 'run', text: 'queue: a1b2' })
  expect(jobLine({ title: 't', lines, running: false, code: 0 })).toEqual({ tone: 'ok', text: 'queue: a1b2' })
  expect(jobLine({ title: 't', lines: [], running: false, code: 2 })).toEqual({ tone: 'fail', text: 'it exited 2' })
  expect(jobLine({ title: 't', lines, running: false, code: null, error: 'mnemo not found' })).toEqual({ tone: 'fail', text: 'mnemo not found' })
})

test('shortPath writes a home folder as ~', () => {
  expect(shortPath('/Users/me/github/mnemo')).toBe('~/github/mnemo')
  expect(shortPath('/home/me/x')).toBe('~/x')
  expect(shortPath('C:\\Users\\me\\x')).toBe('~\\x')
})
