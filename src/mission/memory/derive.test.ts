import { groupHits, since } from './derive'

test('groupHits collapses repeats to one row, counted, most recently fired first', () => {
  const groups = groupHits([
    { slug: 'a', at: 1000 },
    { slug: 'b', at: 2000 },
    { slug: 'a', at: 3000 },
    { slug: 'a', at: null },
  ])
  expect(groups).toEqual([
    { slug: 'a', count: 3, last: 3000 },
    { slug: 'b', count: 1, last: 2000 },
  ])
})

test('groupHits keeps an undated hit, last null when nothing dated', () => {
  expect(groupHits([{ slug: 'a', at: null }])).toEqual([{ slug: 'a', count: 1, last: null }])
})

test('since reports coarser units the further back it was, and blank when undated', () => {
  const now = Date.parse('2026-09-22T12:00:00Z')
  expect(since(now - 10_000, now)).toBe('just now')
  expect(since(now - 5 * 60_000, now)).toBe('5m ago')
  expect(since(now - 3 * 3600_000, now)).toBe('3h ago')
  expect(since(now - 2 * 86400_000, now)).toBe('2d ago')
  expect(since(null, now)).toBe('')
})
