import { SCENES } from '../avatar/scenes'
import type { PulseKind } from '../pulse/types'
import { activityTexture, BUSY, SPAN_MS } from './texture'

const NOW = 1_700_000_000_000
/** A pulse `agoMs` before `NOW`. Ordered oldest first, like the store's own log. */
const at = (agoMs: number, kind: PulseKind = 'tool') => ({ received: NOW - agoMs, event: { kind } })
const min = (n: number) => n * 60_000

test('an empty log is still a row of buckets, all of them empty', () => {
  const bars = activityTexture([], NOW, 6)
  expect(bars).toHaveLength(6)
  expect(bars.every((b) => b.height === 0 && b.tone === 'muted')).toBe(true)
})

test('nothing is asked for, nothing comes back', () => {
  expect(activityTexture([at(min(1))], NOW, 0)).toEqual([])
  expect(activityTexture([at(min(1))], NOW, -3)).toEqual([])
})

test('buckets run oldest first, and a pulse lands in the one its age falls in', () => {
  // Six buckets over an hour: ten minutes each.
  const bars = activityTexture([at(min(55)), at(min(5))], NOW, 6)
  expect(bars.map((b) => b.height > 0)).toEqual([true, false, false, false, false, true])
})

test('a bucket is as tall as its share of the busiest one', () => {
  const log = [...Array(8)].map(() => at(min(55))).concat([...Array(4)].map(() => at(min(5))))
  const bars = activityTexture(log, NOW, 6)
  expect(bars[0].height).toBe(1)
  expect(bars[5].height).toBe(0.5)
})

test('one lone pulse is a mark, not a spike: the busiest bucket has a floor under it', () => {
  expect(activityTexture([at(min(5))], NOW, 6)[5].height).toBe(1 / BUSY)
  // Once the hour is genuinely busy the floor stops mattering and the peak takes over.
  const busy = [...Array(BUSY * 2)].map(() => at(min(5)))
  expect(activityTexture(busy, NOW, 6)[5].height).toBe(1)
})

test('a bucket wears its dominant kind’s tone; a tie goes to whichever happened last', () => {
  // The two `learned` are outnumbered by nothing and outlast nothing — the later `enforce`
  // is the newest pulse in the bucket, and still does not get the bar.
  const dominant = activityTexture([at(min(5), 'learned'), at(min(5), 'learned'), at(min(4), 'enforce')], NOW, 6)
  expect(dominant[5].tone).toBe(SCENES.learned.tone)
  // One each: the later one decides.
  const tied = activityTexture([at(min(5), 'learned'), at(min(4), 'friction')], NOW, 6)
  expect(tied[5].tone).toBe(SCENES.friction.tone)
  expect(SCENES.friction.tone).not.toBe(SCENES.learned.tone)
})

test('an unknown kind is muted rather than a crash', () => {
  const bars = activityTexture([{ received: NOW - min(5), event: { kind: 'no-such-kind' as PulseKind } }], NOW, 6)
  expect(bars[5]).toEqual({ height: 1 / BUSY, tone: 'muted' })
})

test('the window has an edge: older than the span is not in the texture at all', () => {
  expect(activityTexture([at(SPAN_MS)], NOW, 6).every((b) => b.height === 0)).toBe(true)
  expect(activityTexture([at(SPAN_MS + min(30))], NOW, 6).every((b) => b.height === 0)).toBe(true)
  // The oldest pulse the window keeps lands in the oldest bucket.
  expect(activityTexture([at(SPAN_MS - 1)], NOW, 6)[0].height).toBeGreaterThan(0)
})

test('a clock skewed into the future reads as now', () => {
  const ahead = [{ received: NOW + min(10), event: { kind: 'tool' as PulseKind } }]
  const bars = activityTexture(ahead, NOW, 6)
  expect(bars[5].height).toBeGreaterThan(0)
  expect(bars.slice(0, 5).every((b) => b.height === 0)).toBe(true)
})

test('the span is the caller’s to set, and the buckets divide it', () => {
  // Ten minutes in five buckets: two minutes each.
  const bars = activityTexture([at(min(9)), at(min(1))], NOW, 5, min(10))
  expect(bars.map((b) => b.height > 0)).toEqual([true, false, false, false, true])
  expect(activityTexture([at(min(11))], NOW, 5, min(10)).every((b) => b.height === 0)).toBe(true)
})

test('a synthetic hour reads as the shape it was built as', () => {
  // A burst of reading half an hour ago, a quiet stretch, one thing learned just now.
  const log = [
    ...[...Array(6)].map((_, i) => at(min(32) - i * 1000, 'tool')),
    at(min(12), 'enrich'),
    at(min(1), 'learned'),
  ]
  // Twelve buckets of five minutes: 32m ago is bucket 5, 12m ago bucket 9, 1m ago bucket 11.
  const bars = activityTexture(log, NOW, 12, SPAN_MS)
  expect(bars).toHaveLength(12)
  expect(bars.map((b) => Number(b.height > 0))).toEqual([0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1])
  expect(bars[5]).toEqual({ height: 1, tone: SCENES.tool.tone })
  expect(bars[11]).toEqual({ height: 1 / 6, tone: SCENES.learned.tone })
})
