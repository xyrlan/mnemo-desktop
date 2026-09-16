import { createPulseStore, MAX_PULSES, pulseMatches, routePulse, type Claim } from './store'
import type { PulseEvent } from './types'

const ev = (over: Partial<PulseEvent> = {}): PulseEvent => ({ at: 1, kind: 'reflex', project: 'mnemo-desktop', agent: 'mnemo-desktop', slugs: ['run-tests'], ...over })

test('a pulse belongs to a project by its project or its agent; nothing matches no project', () => {
  expect(pulseMatches(ev(), 'mnemo-desktop')).toBe(true)
  expect(pulseMatches(ev({ project: 'x', agent: 'mnemo-desktop' }), 'mnemo-desktop')).toBe(true)
  expect(pulseMatches(ev(), 'mnemo')).toBe(false)
  expect(pulseMatches(ev({ project: '', agent: '' }), '')).toBe(false)
  expect(pulseMatches(ev(), undefined)).toBe(false)
})

describe('routePulse', () => {
  const a: Claim = { pane: 1, place: 'mnemo-desktop', sessionId: 'sa' }
  const b: Claim = { pane: 2, place: 'mnemo-desktop', sessionId: 'sb' }

  test('a session event goes to the pane running that session, whatever the repo says', () => {
    expect(routePulse(ev({ session_id: 'sb' }), [a, b])).toBe(2)
    expect(routePulse(ev({ session_id: 'sa' }), [a, b])).toBe(1)
    expect(routePulse(ev({ session_id: 'sa', project: 'elsewhere', agent: 'elsewhere' }), [a, b])).toBe(1)
  })

  test('an event without a session goes to one pane of its repo: the focused one, else the first to claim', () => {
    expect(routePulse(ev({ kind: 'learned' }), [a, b])).toBe(1)
    expect(routePulse(ev({ kind: 'learned' }), [a, { ...b, focused: true }])).toBe(2)
    expect(routePulse(ev({ kind: 'tool' }), [{ ...a, place: 'mnemo' }, b])).toBe(2)
    expect(routePulse(ev({ project: 'clubinho', agent: 'clubinho' }), [a, b])).toBeUndefined()
  })

  test('an unclaimed session falls back to a repo pane that could be running it, never to one running another', () => {
    const unlearnt: Claim = { pane: 3, place: 'mnemo-desktop' }
    expect(routePulse(ev({ session_id: 'sc' }), [a, b, unlearnt])).toBe(3)
    expect(routePulse(ev({ session_id: 'sc' }), [a, { ...b, focused: true }])).toBeUndefined()
  })

  test('no claims, no pane', () => {
    expect(routePulse(ev(), [])).toBeUndefined()
  })
})

test('claim updates a pane in place and release removes it', () => {
  const s = createPulseStore()
  s.getState().claim({ pane: 1, place: 'x' })
  s.getState().claim({ pane: 2, place: 'x' })
  s.getState().claim({ pane: 1, place: 'x', sessionId: 's' })
  expect(s.getState().claims).toEqual([
    { pane: 1, place: 'x', sessionId: 's' },
    { pane: 2, place: 'x' },
  ])
  s.getState().release(1)
  expect(s.getState().claims).toEqual([{ pane: 2, place: 'x' }])
})

test('two panes on one repo: each sees only its own session, and one of them the sessionless events', () => {
  const s = createPulseStore()
  s.getState().claim({ pane: 1, place: 'mnemo-desktop', sessionId: 'sa' })
  s.getState().claim({ pane: 2, place: 'mnemo-desktop', sessionId: 'sb' })
  s.getState().push(ev({ session_id: 'sa', slugs: ['a'] }), 1)
  s.getState().push(ev({ session_id: 'sb', slugs: ['b'] }), 2)
  s.getState().push(ev({ kind: 'learned', slugs: ['l'] }), 3)
  expect(s.getState().latestFor(1)!.event.slugs).toEqual(['l'])
  expect(s.getState().latestFor(2)!.event.slugs).toEqual(['b'])
  expect([s.getState().countFor(1), s.getState().countFor(2)]).toEqual([2, 1])
  // The routing is fixed on arrival: a later claim does not move a pulse that already landed.
  s.getState().claim({ pane: 2, place: 'mnemo-desktop', sessionId: 'sb', focused: true })
  expect(s.getState().recentFor(1).map((e) => e.slugs[0])).toEqual(['l', 'a'])
  expect(s.getState().recentFor(2).map((e) => e.slugs[0])).toEqual(['b'])
})

test('a pulse no pane claims is logged but counts for no pane', () => {
  const s = createPulseStore()
  s.getState().push(ev(), 1)
  expect(s.getState().log).toHaveLength(1)
  expect(s.getState().log[0].pane).toBeUndefined()
  expect(s.getState().counts).toEqual({})
})

test('recentFor is newest first, per pane, optionally within a window', () => {
  const s = createPulseStore()
  s.getState().claim({ pane: 1, place: 'mnemo-desktop' })
  s.getState().claim({ pane: 2, place: 'mnemo' })
  s.getState().push(ev({ slugs: ['a'] }), 1000)
  s.getState().push(ev({ project: 'mnemo', agent: 'mnemo', slugs: ['b'] }), 2000)
  s.getState().push(ev({ slugs: ['c'] }), 3000)
  expect(s.getState().recentFor(1).map((e) => e.slugs[0])).toEqual(['c', 'a'])
  expect(s.getState().recentFor(1, 1500, 3500).map((e) => e.slugs[0])).toEqual(['c'])
  expect(s.getState().recentFor(9)).toEqual([])
})

test('counters accumulate per pane and outlive the ring buffer', () => {
  const s = createPulseStore()
  s.getState().claim({ pane: 1, place: 'mnemo-desktop' })
  s.getState().claim({ pane: 2, place: 'mnemo' })
  for (let i = 0; i < MAX_PULSES + 5; i++) s.getState().push(ev({ at: i }), i)
  s.getState().push(ev({ project: 'mnemo', agent: 'shared' }), 999)
  expect(s.getState().log).toHaveLength(MAX_PULSES)
  expect(s.getState().log[0].event.at).toBe(6)
  expect(s.getState().countFor(1)).toBe(MAX_PULSES + 5)
  // An event matching two panes counts once, for the pane it went to.
  expect([s.getState().countFor(2), s.getState().countFor(3)]).toEqual([1, 0])
})

test('latestFor keeps its identity until that pane pulses again', () => {
  const s = createPulseStore()
  s.getState().claim({ pane: 1, place: 'mnemo-desktop' })
  s.getState().claim({ pane: 2, place: 'mnemo' })
  expect(s.getState().latestFor(1)).toBeUndefined()
  s.getState().push(ev(), 10)
  const first = s.getState().latestFor(1)
  s.getState().push(ev({ project: 'mnemo', agent: 'mnemo' }), 11)
  expect(s.getState().latestFor(1)).toBe(first)
  s.getState().push(ev({ slugs: ['next'] }), 12)
  expect(s.getState().latestFor(1)).toMatchObject({ received: 12, event: { slugs: ['next'] } })
  expect(s.getState().latestFor(1)!.id).toBeGreaterThan(first!.id)
})
