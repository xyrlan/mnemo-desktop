import { sum, tokens } from '../world/format'
import { sampleWorld } from '../world/sample'
import type { Session, World } from '../world/types'
import { bytes, contextAt, contextReading, layoutFor, limitName, memoryReading, modelName, momentOf, reason, sightReading, span, spentShare, splitPath, took, until, when } from './read'

const world = sampleWorld()
const titled = (start: string): Session => world.sessions.find((s) => s.title.startsWith(start))!
const retries = titled('Idempotent retries')
const pagination = titled('Cursor pagination')
const z = (iso: string) => Date.parse(iso)

/** The sample world with one session replaced. */
const withSession = (s: Session, patch: Partial<Session>): { world: World; session: Session } => {
  const session = { ...s, ...patch }
  return { world: { ...world, sessions: world.sessions.map((x) => (x.id === s.id ? session : x)) }, session }
}

describe('the moment read', () => {
  test('is now without `at`, with null, and with a moment that is not in the past', () => {
    expect(momentOf(world, undefined)).toEqual({ t: world.at, now: world.at, past: false })
    expect(momentOf(world, null).past).toBe(false)
    expect(momentOf(world, world.at)).toEqual({ t: world.at, now: world.at, past: false })
    expect(momentOf(world, world.at + 60_000)).toEqual({ t: world.at, now: world.at, past: false })
  })

  test('is `at` when that is before now', () => {
    expect(momentOf(world, world.at - 1)).toEqual({ t: world.at - 1, now: world.at, past: true })
  })
})

describe('context and tokens, now', () => {
  const r = contextReading(world, retries)

  test('says how full the session is and what is left', () => {
    expect(r.percent).toBe(31)
    expect(r.tokens).toBe(310_000)
    expect(r.window).toBe(1_000_000)
    expect(r.free).toBe(690_000)
    expect(r.hot).toBe(false)
    expect(r.cursor).toBeNull()
    expect(r.share).toBe(1)
  })

  test('is hot from 80% full', () => {
    expect(contextReading(world, titled('Dark theme contrast')).hot).toBe(true)
    const at79 = withSession(retries, { context: { ...retries.context, percent: 79.9 } })
    const at80 = withSession(retries, { context: { ...retries.context, percent: 80 } })
    expect(contextReading(at79.world, at79.session).hot).toBe(false)
    expect(contextReading(at80.world, at80.session).hot).toBe(true)
  })

  test('splits what it spent by who spent it and by kind', () => {
    expect(r.spent).toBe(sum(retries.totals.own))
    expect(tokens(r.spent)).toBe('67M')
    expect(r.main + r.sidechain + r.subagentsSpent).toBe(r.spent)
    expect(r.kinds.map((k) => k.label)).toEqual(['input', 'output', 'cache read', 'cache written'])
    expect(r.kinds.map((k) => k.value)).toEqual([6222, 370_631, 64_710_920, 2_243_545])
    expect(r.kinds.reduce((n, k) => n + k.value, 0)).toBe(r.spent)
    expect(r.kinds[1].thinking).toBe(144_669)
  })

  test('lists its sub-agents and its models, biggest spender first', () => {
    expect(r.subagents.map((a) => a.name)).toEqual(['Map the billing module', 'Survey the route handlers'])
    expect(r.subagents.map((a) => a.spent)).toEqual([...r.subagents.map((a) => a.spent)].sort((a, b) => b - a))
    expect(r.subagents[0]).toMatchObject({ type: 'Explore', calls: 36 })
    const two = withSession(retries, {
      tokens: { ...retries.tokens, byModel: { 'claude-haiku-5-5': { input: 1, output: 1, cacheRead: 0, cacheCreation: 0, thinking: 0 }, 'claude-opus-5-5': retries.tokens.main } },
    })
    expect(contextReading(two.world, two.session).models.map((x) => x.name)).toEqual(['opus 5.5', 'haiku 5.5'])
  })

  test('draws its tree in roster order with itself marked, each by its share', () => {
    expect(r.tree.map((row) => row.session.title)).toEqual([
      'Idempotent retries for the billing webhooks',
      'Webhook signature check before parsing',
      'Forward-only migration for invoices',
      'Cursor pagination for /orders',
      'Tenant in every cache key',
    ])
    expect(r.tree.map((row) => row.depth)).toEqual([0, 1, 1, 1, 1])
    expect(r.tree.filter((row) => row.selected).map((row) => row.session.id)).toEqual([retries.id])
    expect(r.treeSpent).toBe(sum(retries.totals.tree))
    expect(r.tree.reduce((n, row) => n + row.share, 0)).toBeCloseTo(1, 6)
  })

  test("a child's tree is its parent's, with the child marked", () => {
    const child = contextReading(world, pagination)
    expect(child.tree.map((row) => row.session.id)).toEqual(r.tree.map((row) => row.session.id))
    expect(child.tree.filter((row) => row.selected).map((row) => row.session.id)).toEqual([pagination.id])
    expect(child.treeSpent).toBe(r.treeSpent)
  })

  test("puts the session's own account first", () => {
    expect(retries.account).toBe('second')
    expect(r.accounts.map((a) => [a.id, a.own])).toEqual([
      ['second', true],
      ['default', false],
    ])
    expect(contextReading(world, pagination).accounts[0]).toMatchObject({ id: pagination.account, own: true })
  })

  test('counts compactions and keeps the last', () => {
    expect(r.compactions.length).toBe(1)
    expect(r.lastCompaction).toMatchObject({ pre: 783_988, post: 22_001, trigger: 'auto' })
    expect(r.compactionsLater).toBe(0)
  })
})

describe('context and tokens, at a past moment', () => {
  const beforeCliff = z('2026-11-09T18:30:00Z') // the sample compacts at 18:55
  const afterCliff = z('2026-11-09T19:30:00Z')

  test('context is the last call measured by then', () => {
    const m = momentOf(world, beforeCliff)
    const expected = [...retries.context.series].reverse().find(([t]) => t <= beforeCliff)![1]
    expect(contextAt(retries, m)).toBe(expected)
    const r = contextReading(world, retries, beforeCliff)
    expect(r.tokens).toBe(expected)
    expect(r.percent).toBeCloseTo((expected / 1_000_000) * 100, 6)
    expect(r.percent).toBeGreaterThan(60) // the curve was high before it fell
    expect(r.free).toBe(1_000_000 - expected)
  })

  test('a compaction that had not happened yet is later, and not the last', () => {
    const before = contextReading(world, retries, beforeCliff)
    expect(before.compactions.map((c) => c.later)).toEqual([true])
    expect(before.lastCompaction).toBeNull()
    expect(before.compactionsLater).toBe(1)
    const after = contextReading(world, retries, afterCliff)
    expect(after.compactions.map((c) => c.later)).toEqual([false])
    expect(after.lastCompaction?.pre).toBe(783_988)
    expect(after.compactionsLater).toBe(0)
  })

  test('the cursor is where the moment falls on the curve', () => {
    const series = retries.context.series
    const from = series[0][0]
    const to = series[series.length - 1][0]
    expect(contextReading(world, retries, from + (to - from) / 4).cursor).toBeCloseTo(0.25, 6)
    expect(contextReading(world, retries, from - 60_000).cursor).toBe(0)
  })

  test('before the session started there is nothing to read', () => {
    const r = contextReading(world, retries, retries.startedAt! - 60_000)
    expect(r.unborn).toBe(true)
    expect(r.tokens).toBeNull()
    expect(r.percent).toBeNull()
    expect(r.spent).toBe(0)
    expect(contextReading(world, retries, retries.startedAt! + 60_000).unborn).toBe(false)
  })

  test('spend is the share of context the calls so far carried', () => {
    const { world: w, session } = withSession(retries, {
      startedAt: 0,
      context: {
        ...retries.context,
        series: [
          [1000, 100],
          [2000, 300],
          [3000, 400],
          [4000, 200],
        ],
      },
    })
    const now = { ...w, at: 10_000 }
    expect(spentShare(session, momentOf(now, 500))).toBe(0)
    expect(spentShare(session, momentOf(now, 1000))).toBeCloseTo(0.1, 9)
    expect(spentShare(session, momentOf(now, 2500))).toBeCloseTo(0.4, 9)
    expect(spentShare(session, momentOf(now, 4000))).toBe(1)
    expect(spentShare(session, momentOf(now, null))).toBe(1)
    const r = contextReading(now, session, 2500)
    expect(r.share).toBeCloseTo(0.4, 9)
    expect(r.spent).toBe(Math.round(sum(session.totals.own) * 0.4))
    expect(r.kinds[0].value).toBe(Math.round(session.totals.own.input * 0.4))
  })

  test('without a curve, spend is the share of its life lived', () => {
    const { world: w, session } = withSession(retries, { startedAt: 1000, lastAt: 5000, context: { ...retries.context, series: [] } })
    const now = { ...w, at: 10_000 }
    expect(spentShare(session, momentOf(now, 2000))).toBeCloseTo(0.25, 9)
    expect(spentShare(session, momentOf(now, 500))).toBe(0)
    expect(spentShare(session, momentOf(now, 9000))).toBe(1)
  })
})

describe('memory', () => {
  const r = memoryReading(world, retries)

  test('counts what was given, asked for and held back', () => {
    expect([r.givenCount, r.askedCount, r.heldCount, r.prompts]).toEqual([4, 4, 10, 15])
  })

  test('lists each newest first', () => {
    for (const list of [r.given, r.asked, r.held, r.touches]) {
      expect(list.map((x) => x.at)).toEqual([...list.map((x) => x.at)].sort((a, b) => b - a))
      expect(list.some((x) => x.later)).toBe(false)
    }
    expect(r.given[0].slug).toBe('dispatch-children-push-before-stop')
  })

  test('says why rules were held back, the most frequent reason first', () => {
    expect(r.reasons.map((x) => [x.count, x.words])).toEqual([
      [6, 'below the bar to speak'],
      [3, 'the judge found none relevant'],
      [1, 'already given, deduplicated'],
    ])
    expect(r.reasons.reduce((n, x) => n + x.count, 0)).toBe(r.heldCount)
  })

  test('names what a session asked for by its rule, else by its topic and query', () => {
    expect(r.asked.map((x) => x.what)).toEqual([
      'timezones-store-utc-render-local',
      'optimistic-ui-rolls-back-on-409',
      'webhook-signature-before-parse',
      'testing · retry a webhook without charging twice',
    ])
  })

  test('sums the vault: spoke, and stayed silent for every other outcome', () => {
    expect(r.vault).toEqual({ rules: 4160, prompts: 1039, spoke: 219, silent: 819 })
  })

  test('at a past moment counts to it, and puts what had happened before what had not', () => {
    const at = z('2026-11-09T18:30:00Z')
    const past = memoryReading(world, retries, at)
    expect(past.givenCount).toBe(retries.memory.trail.injected.filter((x) => x.at <= at).length)
    expect(past.heldCount).toBe(retries.memory.trail.considered.filter((x) => x.at <= at).length)
    expect(past.heldCount).toBeGreaterThan(0)
    expect(past.heldCount).toBeLessThan(r.heldCount)
    // what had happened: newest first; then what had not: soonest first
    const happened = past.held.filter((x) => !x.later)
    const later = past.held.filter((x) => x.later)
    expect(past.held).toEqual([...happened, ...later])
    expect(happened.every((x) => x.at <= at)).toBe(true)
    expect(later.every((x) => x.at > at)).toBe(true)
    expect(happened.map((x) => x.at)).toEqual([...happened.map((x) => x.at)].sort((a, b) => b - a))
    expect(later.map((x) => x.at)).toEqual([...later.map((x) => x.at)].sort((a, b) => a - b))
    // the reasons are counted to the moment too
    expect(past.reasons.reduce((n, x) => n + x.count, 0)).toBe(past.heldCount)
  })

  test('the dial turns with time: twelve at the start, 330 degrees at the end, a hand only in the past', () => {
    expect(r.dial.hand).toBeNull()
    const marks = [...r.dial.given, ...r.dial.asked, ...r.dial.held]
    expect(marks.length).toBe(18)
    for (const mk of marks) {
      expect(mk.angle).toBeGreaterThanOrEqual(0)
      expect(mk.angle).toBeLessThanOrEqual(330)
    }
    // held is newest first, so its angles fall
    expect(r.dial.held.map((mk) => mk.angle)).toEqual([...r.dial.held.map((mk) => mk.angle)].sort((a, b) => b - a))
    const end = memoryReading(world, retries, retries.lastAt! - 1)
    expect(end.dial.hand).toBeGreaterThan(329)
    const early = memoryReading(world, retries, z('2026-11-09T12:00:00Z'))
    expect(early.dial.hand).toBeGreaterThan(0)
    expect(early.dial.hand).toBeLessThan(end.dial.hand!)
    expect(early.dial.given.filter((mk) => mk.later).length).toBe(3)
  })

  test('words a reason code, and shows one it does not know as it came', () => {
    expect(reason('judge_none_relevant')).toBe('the judge found none relevant')
    expect(reason('some_new_code')).toBe('some new code')
    expect(reason(null)).toBe('no reason recorded')
  })
})

describe('sight', () => {
  const r = sightReading(world, retries)

  test('counts what the session saw on the web, edited and opened', () => {
    expect([r.webCount, r.editedCount, r.prCount]).toEqual([7, 3, 0])
    expect(sightReading(world, pagination).prCount).toBe(1)
  })

  test('a page it took a picture of is shown as the picture, not twice', () => {
    expect(r.shots.map((x) => x.url)).toEqual(['http://localhost:5173/orders', 'http://localhost:5173/orders/8841'])
    expect(r.pages).toEqual([])
    const more = withSession(retries, { web: { ...retries.web, pages: [...retries.web.pages, { at: retries.web.pages[0].at - 1000, url: 'http://localhost:5173/customers', title: 'Customers' }] } })
    const seen = sightReading(more.world, more.session)
    expect(seen.pages.map((p) => p.url)).toEqual(['http://localhost:5173/customers'])
    expect(seen.webCount).toBe(8)
  })

  test('at a past moment counts to it and marks the rest as later', () => {
    const at = z('2026-11-09T20:50:00Z') // after the search and the fetch, before the pages and the artifact
    const past = sightReading(world, retries, at)
    expect(past.webCount).toBe(2)
    expect(past.shots.map((x) => x.later)).toEqual([true, true])
    expect(past.searches.map((x) => x.later)).toEqual([false])
    expect(past.fetches.map((x) => x.later)).toEqual([false])
    expect(past.artifacts.map((x) => x.later)).toEqual([true])
    expect(past.editedCount).toBe(3)
    const early = sightReading(world, retries, z('2026-11-09T19:00:00Z'))
    expect(early.edited.map((x) => [x.path.split('/').pop(), x.later])).toEqual([
      ['OrderRow.tsx', true],
      ['orders.ts', false],
      ['cache.ts', true],
    ])
    expect(early.editedCount).toBe(1)
  })

  test('a pull request is dated by the event that opened it', () => {
    const pr = pagination.prs[0]
    const opened = world.events.find((e) => e.session === pagination.id && e.text === `#${pr.number}`)!
    expect(opened).toBeDefined()
    expect(sightReading(world, pagination, opened.at - 1).prs.map((p) => p.later)).toEqual([true])
    expect(sightReading(world, pagination, opened.at - 1).prCount).toBe(0)
    expect(sightReading(world, pagination, opened.at).prs.map((p) => p.later)).toEqual([false])
    // one the world has no event for is never dimmed
    const undated = { ...world, events: [] }
    expect(sightReading(undated, pagination, opened.at - 1).prs.map((p) => p.later)).toEqual([false])
  })
})

describe('words', () => {
  test('when: ago now, before and later around a past moment', () => {
    const now = momentOf(world, null)
    expect(when(world.at - 36 * 60_000, now)).toBe('36m ago')
    const past = momentOf(world, world.at - 3_600_000)
    expect(when(past.t - 12 * 60_000, past)).toBe('12m before')
    expect(when(past.t + 8 * 60_000, past)).toBe('8m later')
    expect(when(null, now)).toBe('')
  })

  test('a length of time takes one unit', () => {
    expect([span(40_000), span(4 * 60_000), span(2 * 3_600_000), span(3 * 86_400_000), span(-5)]).toEqual(['40s', '4m', '2h', '3d', '0s'])
  })

  test('what a call took', () => {
    expect([took(320), took(9096), took(45_000), took(245_000), took(4_920_000), took(null)]).toEqual(['320ms', '9.1s', '45s', '4m 05s', '1h 22m', ''])
  })

  test('bytes', () => {
    expect([bytes(848), bytes(1804), bytes(70_157), bytes(3_500_000), bytes(null)]).toEqual(['848 B', '1.8 kB', '69 kB', '3.3 MB', ''])
  })

  test('a model id is said short', () => {
    expect(modelName('claude-opus-5-5')).toBe('opus 5.5')
    expect(modelName('claude-fable-5-2[1m]')).toBe('fable 5.2')
    expect(modelName('claude-haiku-5-5-20261001')).toBe('haiku 5.5')
    expect(modelName('claude-sonnet-5')).toBe('sonnet 5')
    expect(modelName(null)).toBe('')
  })

  test('a path keeps its file and the two folders above it', () => {
    expect(splitPath('~/work/atlas-api/src/ui/OrderRow.tsx')).toEqual({ dir: '…/src/ui/', base: 'OrderRow.tsx' })
    expect(splitPath('C:\\code\\app\\main.ts')).toEqual({ dir: '…/code/app/', base: 'main.ts' })
    expect(splitPath('src/main.ts')).toEqual({ dir: 'src/', base: 'main.ts' })
    expect(splitPath('README.md')).toEqual({ dir: '', base: 'README.md' })
  })

  test('when a plan window resets', () => {
    const now = 1_000_000_000
    expect(until(now + 20 * 60_000, now)).toBe('resets in 20m')
    expect(until(now + 140 * 60_000, now)).toBe('resets in 2h 20m')
    expect(until(now + (2 * 24 + 23) * 3_600_000, now)).toBe('resets in 2d 23h')
    expect(until(now - 1, now)).toBe('reset due')
    expect(until(null, now)).toBe('')
  })

  test('a plan window is named, a scoped one with its model', () => {
    expect(limitName('session', null)).toBe('5-hour window')
    expect(limitName('weekly_all', null)).toBe('Week, all models')
    expect(limitName('weekly_scoped', 'Fable')).toBe('Week, Fable')
    expect(limitName('some_new_window', null)).toBe('some new window')
  })
})

describe('the column', () => {
  test('one reading at a time until there is room for all three, then three across', () => {
    expect(layoutFor(0)).toBe('one')
    expect(layoutFor(30)).toBe('one')
    expect(layoutFor(45.9)).toBe('one')
    expect(layoutFor(46)).toBe('pair')
    expect(layoutFor(61)).toBe('pair')
    expect(layoutFor(83.9)).toBe('pair')
    expect(layoutFor(84)).toBe('three')
    expect(layoutFor(120)).toBe('three')
  })
})
