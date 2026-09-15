import { createPulseStore, MAX_PULSES, pulseMatches } from './store'
import type { PulseEvent } from './types'

const ev = (over: Partial<PulseEvent> = {}): PulseEvent => ({ at: 1, kind: 'reflex', project: 'mnemo-desktop', agent: 'mnemo-desktop', slugs: ['run-tests'], ...over })

test('a pulse belongs to a project by its project or its agent; nothing matches no project', () => {
  expect(pulseMatches(ev(), 'mnemo-desktop')).toBe(true)
  expect(pulseMatches(ev({ project: 'x', agent: 'mnemo-desktop' }), 'mnemo-desktop')).toBe(true)
  expect(pulseMatches(ev(), 'mnemo')).toBe(false)
  expect(pulseMatches(ev({ project: '', agent: '' }), '')).toBe(false)
  expect(pulseMatches(ev(), undefined)).toBe(false)
})

test('recentFor is newest first, per project, optionally within a window', () => {
  const s = createPulseStore()
  s.getState().push(ev({ slugs: ['a'] }), 1000)
  s.getState().push(ev({ project: 'mnemo', agent: 'mnemo', slugs: ['b'] }), 2000)
  s.getState().push(ev({ slugs: ['c'] }), 3000)
  expect(s.getState().recentFor('mnemo-desktop').map((e) => e.slugs[0])).toEqual(['c', 'a'])
  expect(s.getState().recentFor('mnemo-desktop', 1500, 3500).map((e) => e.slugs[0])).toEqual(['c'])
  expect(s.getState().recentFor('nowhere')).toEqual([])
})

test('counters accumulate per project and outlive the ring buffer', () => {
  const s = createPulseStore()
  for (let i = 0; i < MAX_PULSES + 5; i++) s.getState().push(ev({ at: i }), i)
  s.getState().push(ev({ project: 'mnemo', agent: 'shared' }), 999)
  expect(s.getState().log).toHaveLength(MAX_PULSES)
  expect(s.getState().log[0].event.at).toBe(6)
  expect(s.getState().countFor('mnemo-desktop')).toBe(MAX_PULSES + 5)
  // Project and agent both count, once each.
  expect([s.getState().countFor('mnemo'), s.getState().countFor('shared'), s.getState().countFor('x')]).toEqual([1, 1, 0])
})

test('latestFor keeps its identity until that project pulses again', () => {
  const s = createPulseStore()
  expect(s.getState().latestFor('mnemo-desktop')).toBeUndefined()
  s.getState().push(ev(), 10)
  const first = s.getState().latestFor('mnemo-desktop')
  s.getState().push(ev({ project: 'mnemo', agent: 'mnemo' }), 11)
  expect(s.getState().latestFor('mnemo-desktop')).toBe(first)
  s.getState().push(ev({ slugs: ['next'] }), 12)
  expect(s.getState().latestFor('mnemo-desktop')).toMatchObject({ received: 12, event: { slugs: ['next'] } })
  expect(s.getState().latestFor('mnemo-desktop')!.id).toBeGreaterThan(first!.id)
})
