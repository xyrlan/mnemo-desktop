import dryRun from './fixtures/dry-run.json?raw'
import dryRunNone from './fixtures/dry-run-none.json?raw'
import listing from './fixtures/listing.json?raw'
import progress from './fixtures/progress.jsonl?raw'
import promoteFailed from './fixtures/promote-failed.json?raw'
import drop from './fixtures/drop.json?raw'
import { day, firstExpiry, groupPages, jsonOf, parseDecided, parseDryRun, parseListing, parseProgress } from './types'

test('the dry run reads its session count and call estimate', () => {
  expect(parseDryRun(dryRun)).toEqual({ project: 'clubinho', sessions: 44, callsEstimate: 19, priceUsd: 1.2 })
  expect(parseDryRun(dryRunNone)?.sessions).toBe(0)
  expect(parseDryRun('mnemo: no such option --dry-run')).toBeNull()
  expect(parseDryRun('{"project": "x"}')).toBeNull()
})

test('the listing reads every page with its excerpt and expiry', () => {
  const l = parseListing(listing)!
  expect(l.project).toBe('clubinho')
  expect(l.pages.map((p) => p.key)).toEqual([
    'project/clubinho__cron-annual-bloqueado-183',
    'project/clubinho__staging-db-is-shared',
    'feedback/clubinho__answer-in-portuguese',
    'reference/clubinho__asaas-sandbox',
    'user/clubinho__runs-on-a-mac',
  ])
  expect(l.pages[0]).toEqual({
    key: 'project/clubinho__cron-annual-bloqueado-183',
    type: 'project',
    name: 'Annual cron blocked until #183',
    description: 'The annual billing cron stays disabled until #183 lands.',
    excerpt: expect.stringContaining('double-charged'),
    stagedAt: '2026-09-24T10:12:03',
    expiresAt: '2026-10-08T10:12:03',
  })
  expect(parseListing('{"pages": [{"name": "no key"}, {"key": "feedback/x"}]}')!.pages).toEqual([
    { key: 'feedback/x', type: 'feedback', name: 'feedback/x', description: '', excerpt: '', stagedAt: '', expiresAt: '' },
  ])
  expect(parseListing('0 staged pages')).toBeNull()
})

test('pages group in the spec order, other types after under their own name', () => {
  const groups = groupPages(parseListing(listing)!.pages)
  expect(groups.map((g) => [g.label, g.pages.length])).toEqual([
    ['Project facts', 2],
    ['Your rules', 1],
    ['Technical references', 1],
    ['user', 1],
  ])
  expect(groupPages([])).toEqual([])
})

test('a decision reads what it did and what failed, for either flag', () => {
  expect(parseDecided(promoteFailed, 'promoted')).toEqual({
    done: ['project/clubinho__cron-annual-bloqueado-183', 'feedback/clubinho__answer-in-portuguese', 'reference/clubinho__asaas-sandbox'],
    failed: [{ key: 'user/clubinho__runs-on-a-mac', error: 'not staged' }],
  })
  expect(parseDecided(drop, 'dropped')).toEqual({ done: ['project/clubinho__staging-db-is-shared'], failed: [] })
  // The other flag's answer is not this one's.
  expect(parseDecided(drop, 'promoted')).toBeNull()
  expect(parseDecided('Traceback (most recent call last):', 'dropped')).toBeNull()
})

test('progress lines read as events, anything else is skipped', () => {
  const events = progress.split('\n').filter(Boolean).map(parseProgress)
  expect(events[0]).toEqual({ event: 'harvest', done: 1, of: 44 })
  expect(events[3]).toEqual({ event: 'extract', done: 1, of: 8 })
  expect(events.at(-1)).toEqual({ event: 'done', staged: 5, live: 0, failed: 1 })
  expect(parseProgress('harvesting 3 of 44')).toBeNull()
  expect(parseProgress('{"event": "harvest", "done": 3}')).toBeNull()
  expect(parseProgress('{"event": "later"}')).toBeNull()
})

test('a warning printed before the JSON is skipped, not taken for the answer', () => {
  expect(jsonOf(`warning: config is old\n${dryRun}`)).toMatchObject({ sessions: 44 })
  expect(jsonOf('no json here')).toBeUndefined()
})

test('the first expiry is the earliest, by day', () => {
  const pages = parseListing(listing)!.pages
  expect(firstExpiry(pages)).toBe('2026-10-08T10:12:03')
  expect(day(firstExpiry(pages)!)).toBe('2026-10-08')
  expect(firstExpiry([])).toBeNull()
})
