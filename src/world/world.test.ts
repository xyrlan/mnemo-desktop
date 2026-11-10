import { armedPending, nextPending } from '../pending'
import { fromCapture } from './capture'
import { age, sum, tilde, tokens } from './format'
import { choicesFor } from './pending'
import { HOME, format, parse } from './route'
import { sampleActions, sampleWorld } from './sample'
import { childrenOf, pendingInOrder, rosterOrder, roots, sessionOf, urgency } from './store'
import { STATE_ORDER, type World } from './types'

const world = sampleWorld()

describe('the sample world', () => {
  test('is the capture with every time in epoch ms', () => {
    expect(world.source).toBe('sample')
    expect(world.sessions.length).toBe(15)
    expect(world.at).toBe(Date.parse('2026-11-09T21:30:00Z'))
    for (const s of world.sessions) {
      expect(STATE_ORDER).toContain(s.state)
      for (const a of s.activity) expect(a.at).toBeGreaterThan(1.7e12)
      for (const [t] of s.context.series) expect(t).toBeGreaterThan(1.7e12)
    }
  })

  test('a tree total is the session and its children', () => {
    for (const s of world.sessions) {
      const kids = childrenOf(world, s).reduce((n, c) => n + sum(c.totals.own), 0)
      expect(sum(s.totals.tree)).toBe(sum(s.totals.own) + kids)
    }
  })

  test('every waiting item names a session and carries its choices from 1', () => {
    expect(world.pending.length).toBe(5)
    for (const p of world.pending) {
      expect(sessionOf(world, p.session)).toBeDefined()
      expect(p.choices.map((c) => c.key)).toEqual(p.choices.map((_, i) => i + 1))
      expect(p.choices.length).toBeGreaterThan(1)
    }
  })

  test('a session is found by its id and by its first 8 characters', () => {
    const s = world.sessions[0]
    expect(sessionOf(world, s.id)).toBe(s)
    expect(sessionOf(world, s.short)).toBe(s)
    expect(sessionOf(world, 'nope')).toBeUndefined()
  })
})

describe('the order of attention', () => {
  test('a family rises with its most urgent member', () => {
    const order = roots(world)
    const ranks = order.map((s) => urgency(world, s))
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
    // the idle parent whose child waits for a merge stands above the working one with no child
    const lumen = order.findIndex((s) => s.title.startsWith('Optimistic updates'))
    const bundle = order.findIndex((s) => s.title.startsWith('Why is the bundle'))
    expect(lumen).toBeLessThan(bundle)
  })

  test('the roster walks each root, then its children', () => {
    const order = rosterOrder(world)
    expect(order.length).toBe(world.sessions.length)
    for (const s of order) if (s.parent) expect(order.indexOf(s)).toBeGreaterThan(order.findIndex((p) => p.id === s.parent))
  })

  test('what waits is walked down the roster, wrapping', () => {
    const order = pendingInOrder(world)
    const place = rosterOrder(world).map((s) => s.id)
    const at = order.map((p) => place.indexOf(p.session))
    expect(at).toEqual([...at].sort((a, b) => a - b))
    let route = { ...HOME }
    const seen: string[] = []
    for (let i = 0; i < order.length + 1; i++) {
      const next = nextPending(world, route)!
      seen.push(next.id)
      route = { ...route, pending: next.id, session: next.session }
    }
    expect(seen.slice(0, order.length)).toEqual(order.map((p) => p.id))
    expect(seen[order.length]).toBe(order[0].id)
  })

  test('digits answer the open card, else what waits on the selected session', () => {
    const [a, b] = world.pending
    expect(armedPending(world, { ...HOME, pending: b.id, session: a.session })?.id).toBe(b.id)
    expect(armedPending(world, { ...HOME, session: a.session })?.id).toBe(a.id)
    expect(armedPending(world, HOME)).toBeNull()
  })
})

describe('answering in the sample world', () => {
  const held = (): { world: World; said: string[]; act: ReturnType<typeof sampleActions> } => {
    const box = { world: sampleWorld(), said: [] as string[] }
    return Object.assign(box, { act: sampleActions(() => box.world, (w) => (box.world = w), box.said) })
  }

  test('a choice settles its item and moves its session on', async () => {
    const h = held()
    const item = h.world.pending.find((p) => p.kind === 'question')!
    expect(await h.act.answer(item.id, 1)).toEqual({ ok: true, note: item.choices[0].label })
    expect(h.world.pending.some((p) => p.id === item.id)).toBe(false)
    expect(sessionOf(h.world, item.session)?.state).toBe('working')
    expect(h.said).toEqual([`answer ${item.id} 1`])
  })

  test('an answer to what no longer waits is refused in words', async () => {
    const h = held()
    expect(await h.act.answer('gone:question', 1)).toEqual({ ok: false, why: 'That is no longer waiting.' })
    expect(await h.act.answer(h.world.pending[0].id, 99)).toEqual({ ok: false, why: 'That is no longer waiting.' })
    expect(h.world.pending.length).toBe(5)
  })

  test('merging the green ones leaves the one whose checks still run', async () => {
    const h = held()
    const out = await h.act.mergeGreen()
    expect(out).toEqual({ ok: true, note: '1 merged' })
    expect(h.world.pending.filter((p) => p.kind === 'merge').map((p) => p.pr?.ci)).toEqual(['running'])
  })
})

describe('choices', () => {
  test('a question keeps its own options; the rest are fixed lists', () => {
    expect(choicesFor('question', [{ label: 'A', description: 'a' }, { label: 'B' }], null).map((c) => [c.key, c.label, c.hint, c.tone])).toEqual([
      [1, 'A', 'a', 'neutral'],
      [2, 'B', null, 'neutral'],
    ])
    expect(choicesFor('permission', [], null).map((c) => c.tone)).toEqual(['good', 'good', 'bad'])
    expect(choicesFor('merge', [], { number: 7, url: '', repo: '', state: 'open', draft: false, title: null, ci: 'running', mergeable: null })[0].label).toBe('Merge when green')
    expect(choicesFor('stalled', [], null).map((c) => c.label)).toEqual(['Try again', 'Stop it'])
  })
})

describe('the route', () => {
  test('survives the hash both ways', () => {
    const route = { ...HOME, view: 'console' as const, session: 'abc', reading: 'memory' as const, at: 1794000000000, pending: 'abc:question', panel: 'missions' as const, wide: true, command: true }
    expect(parse(format(route))).toEqual(route)
    expect(parse('')).toEqual(HOME)
    expect(parse('#v=nowhere&r=nothing&at=soon')).toEqual(HOME)
    expect(format(HOME)).toBe('#v=orbit')
  })
})

describe('formats', () => {
  test('tokens, ages and home paths read the same everywhere', () => {
    expect([999, 1234, 56_000, 3_400_000, 42_000_000, 1_600_000_000].map(tokens)).toEqual(['999', '1.2k', '56k', '3.4M', '42M', '1.6B'])
    expect(tokens(null)).toBe('–')
    const now = 1_000_000_000
    expect([now - 40_000, now - 4 * 60_000, now - 2 * 3_600_000, now - 3 * 86_400_000].map((t) => age(t, now))).toEqual(['40s', '4m', '2h', '3d'])
    expect(age(null, now)).toBe('')
    expect([String.raw`C:\Users\someone\work\repo`, '/Users/someone/work', '/home/someone', '/srv/x'].map(tilde)).toEqual(['~/work/repo', '~/work', '~', '/srv/x'])
  })

  test('a capture with a session and nothing else still makes a world', () => {
    const bare = fromCapture({ capturedAt: '2026-01-01T00:00:00Z', sessions: [{ id: 'a'.repeat(36), short: 'aaaaaaaa', role: 'parent', state: 'idle', live: true }] })
    expect(bare.sessions[0].title).toBe('session aaaaaaaa')
    expect(bare.sessions[0].context.window).toBe(200_000)
    expect(bare.pending).toEqual([])
  })
})
