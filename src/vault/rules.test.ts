import { applyChips, confidenceTone, facets, NO_CHIPS, reviewCount, scopeAgents, sinceText, withStale } from './rules'
import type { Health, RuleRow } from './types'

const row = (slug: string, over: Partial<RuleRow> = {}): RuleRow => ({
  path: `/v/shared/feedback/${slug}.md`,
  slug,
  name: slug,
  description: '',
  type: 'feedback',
  agent: 'shared',
  confidence: null,
  topics: [],
  fires: 1,
  last_fired: null,
  heat: 1,
  badges: [],
  reasons: [],
  ...over,
})

test('stale marks the rows mnemo stale names, by path or by slug, keeping badge order', () => {
  const rows = [row('a', { badges: ['never', 'review'], reasons: ['verified without evidence'] }), row('b'), row('c')]
  const out = withStale(rows, [
    { slug: 'mnemo-desktop__a', reason: 'cites a deleted file', path: null },
    { slug: 'whatever', reason: '', path: '/v/shared/feedback/b.md' },
  ])
  expect(out.map((r) => [r.slug, r.badges, r.reasons])).toEqual([
    ['a', ['never', 'stale', 'review'], ['verified without evidence', 'stale: cites a deleted file']],
    ['b', ['stale'], []],
    ['c', [], []],
  ])
  expect(out[2]).toBe(rows[2])
  expect(withStale(rows, null)).toBe(rows)
  expect(withStale(rows, [])).toBe(rows)
})

test('chips narrow by type, case-folded topic and problems, all at once', () => {
  const rows = [
    row('a', { topics: ['Testing'], badges: ['never'] }),
    row('b', { type: 'project', topics: ['testing'] }),
    row('c', { topics: ['build'], badges: ['inbox'] }),
  ]
  const slugs = (r: RuleRow[]) => r.map((x) => x.slug)
  expect(applyChips(rows, NO_CHIPS)).toBe(rows)
  expect(slugs(applyChips(rows, { ...NO_CHIPS, type: 'feedback' }))).toEqual(['a', 'c'])
  expect(slugs(applyChips(rows, { ...NO_CHIPS, topic: 'testing' }))).toEqual(['a', 'b'])
  expect(slugs(applyChips(rows, { ...NO_CHIPS, problems: true }))).toEqual(['a', 'c'])
  expect(slugs(applyChips(rows, { type: 'feedback', topic: 'testing', problems: true }))).toEqual(['a'])
})

test('facets count types and the commonest case-folded topics once per row', () => {
  const rows = [row('a', { topics: ['Testing', 'testing ', 'git'] }), row('b', { type: 'project', topics: ['testing'] }), row('c', { topics: ['build'] })]
  expect(facets(rows)).toEqual({
    types: [
      { name: 'feedback', count: 2 },
      { name: 'project', count: 1 },
    ],
    topics: [
      { name: 'testing', count: 2 },
      { name: 'build', count: 1 },
      { name: 'git', count: 1 },
    ],
  })
  expect(facets(rows, 1).topics).toEqual([{ name: 'testing', count: 2 }])
})

test('scopes offer shared, the current repo, then the rest by name', () => {
  expect(scopeAgents(['zeta', 'mnemo-desktop', 'shared', 'alpha', 'zeta'], 'mnemo-desktop')).toEqual(['shared', 'mnemo-desktop', 'alpha', 'zeta'])
  expect(scopeAgents([], undefined)).toEqual(['shared'])
})

test('the review count is one per page across both lists, plus stale rules not already in them', () => {
  const r = (slug: string) => ({ path: `/v/${slug}.md`, slug, name: slug, reason: '' })
  const health = { label_only: [r('a')], dormant: [r('a'), r('b')] } as Health
  expect(reviewCount(health, null)).toBe(2)
  expect(reviewCount(health, [{ slug: 'x__a', reason: '', path: null }, { slug: 'c', reason: '', path: null }])).toBe(3)
  expect(reviewCount(null, [{ slug: 'c', reason: '', path: '/v/c.md' }])).toBe(1)
})

test('since is today, days ago, then the date', () => {
  const now = Date.UTC(2026, 8, 15, 12)
  expect(sinceText(null, now)).toBe('—')
  expect(sinceText(now - 3600_000, now)).toBe('today')
  expect(sinceText(now + 3600_000, now)).toBe('today')
  expect(sinceText(now - 3 * 86400_000, now)).toBe('3d ago')
  expect(sinceText(Date.UTC(2026, 5, 1), now)).toBe('2026-06-01')
})

test('confidence colours', () => {
  expect(['verified', 'verified-elsewhere', 'Verified CI', 'ci', 'inferred', 'demoted', null, 'observed'].map(confidenceTone)).toEqual(['ok', 'accent', 'accent', 'accent', 'muted', 'bad', 'warn', 'warn'])
})
