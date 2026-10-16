import type { DrawerTab } from '../store'
import { reposFixture, shipFixture } from './fixtures'
import { findFigure } from './model'
import { fitPills, pillOf, rowsOf, shortName } from './pills'

const tab = (over: Partial<DrawerTab>): DrawerTab => ({ id: 'session:1', kind: 'session', key: 'pane:1', readOnly: null, label: 'shell · mnemo-desktop', sessionId: null, cwd: null, ...over })

test('a short name: the first words that fit in 14 characters, a long first word cut short', () => {
  expect(shortName('Subscriber cohort analysis for the annual plans')).toBe('Subscriber')
  expect(shortName('Release notes for the next minor version')).toBe('Release notes')
  expect(shortName('nexus round')).toBe('nexus round')
  expect(shortName('#465')).toBe('#465')
  expect(shortName('c-preview-harness-and-more')).toBe('c-preview-har…')
  // A word of marks only never ends it.
  expect(shortName('claude · mnemo-desktop')).toBe('claude')
  expect(shortName('  ')).toBe('')
})

test('a pill: a child its issue, a captain its emblem and short name, a shell $ and its repo', () => {
  const ship = shipFixture()
  expect(pillOf(tab({ id: 'r-live', kind: 'robot' }), findFigure(ship, 'r-live'), reposFixture)).toEqual({ text: '#682·a', full: '#682·a' })
  expect(pillOf(tab({ id: 'cap-1', kind: 'captain' }), findFigure(ship, 'cap-1'), reposFixture)).toEqual({ text: '◆ nexus round', full: '◆ nexus round' })
  // A shell in a worktree is its repo's.
  expect(pillOf(tab({ cwd: '/work/mnemo-desktop-wt-682/src' }), null, reposFixture).text).toBe('$ mnemo-desktop')
  expect(pillOf(tab({ cwd: '/tmp/scratch' }), null, []).text).toBe('$ scratch')
  expect(pillOf(tab({ label: 'npm run dev' }), null, [])).toEqual({ text: 'npm run dev', full: 'npm run dev' })
})

test('rows as flex-wrap lays them', () => {
  expect(rowsOf([], 100, 5)).toBe(0)
  expect(rowsOf([40, 40], 100, 5)).toBe(1)
  expect(rowsOf([40, 40, 40], 100, 5)).toBe(2)
  expect(rowsOf([120], 100, 5)).toBe(1)
})

describe('fitPills', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
  const w = (id: string) => (id === 'g' ? 90 : 40)
  const more = () => 20

  test('every pill when they fit in two rows', () => {
    expect(fitPills(ids, w, more, 1000, 5, 'a')).toEqual({ order: ids, shown: 7 })
  })

  test('past two rows, as many as fit with +N after them', () => {
    // 100 px: two 40s a row, so four fit; with +N on the second row, three.
    expect(fitPills(ids, w, more, 100, 5, 'a')).toEqual({ order: ids, shown: 3 })
  })

  test('the active pill is always among those drawn, in the last place', () => {
    expect(fitPills(ids, w, more, 100, 5, 'e')).toEqual({ order: ['a', 'b', 'e', 'c', 'd', 'f', 'g'], shown: 3 })
    // Wider, it makes the room smaller: it moves again.
    const r = fitPills(ids, w, more, 105, 5, 'g')
    expect(r.order.slice(0, r.shown)).toContain('g')
    expect(r.shown).toBe(2)
  })
})
