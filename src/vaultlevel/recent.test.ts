import { SCENES } from '../avatar/scenes'
import type { PulseKind } from '../pulse/types'
import { recentPulses, toneOfKind } from './recent'

const log = (...kinds: PulseKind[]) => kinds.map((kind) => ({ event: { kind } }))

test('an empty log has no trail', () => {
  expect(recentPulses([], 5)).toEqual([])
})

test('fewer runs than asked are all there, oldest first, with no placeholders', () => {
  expect(recentPulses(log('reflex', 'learned'), 5)).toEqual([
    { kind: 'reflex', count: 1 },
    { kind: 'learned', count: 1 },
  ])
})

test('consecutive repeats of one kind fold into one run with a count', () => {
  expect(recentPulses(log('tool', 'tool', 'tool', 'enrich', 'tool'), 5)).toEqual([
    { kind: 'tool', count: 3 },
    { kind: 'enrich', count: 1 },
    { kind: 'tool', count: 1 },
  ])
})

test('the trail stops at n runs, counting the oldest kept run in full', () => {
  const trail = recentPulses(log('dispatch', 'reflex', 'reflex', 'tool', 'enrich', 'enforce', 'friction'), 5)
  expect(trail.map((t) => t.kind)).toEqual(['reflex', 'tool', 'enrich', 'enforce', 'friction'])
  expect(trail[0].count).toBe(2)
  expect(recentPulses(log('tool', 'reflex'), 0)).toEqual([])
})

test('a dot takes its scene’s tone', () => {
  for (const kind of Object.keys(SCENES) as PulseKind[]) expect(toneOfKind(kind)).toBe(SCENES[kind].tone)
})
