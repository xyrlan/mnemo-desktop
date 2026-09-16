import { SCENES, STATE_SCENES, caption, withPartIndex } from './scenes'
import type { PulseEvent } from '../pulse/types'

const ev = (over: Partial<PulseEvent>): PulseEvent => ({ at: 1, kind: 'reflex', project: 'mnemo', agent: 'mnemo', slugs: [], ...over })

test('every kind and every child state has a scene', () => {
  expect(Object.keys(SCENES).sort()).toEqual(
    ['briefing', 'catchup', 'dispatch', 'enforce', 'enrich', 'friction', 'learned', 'reflex', 'tool'].sort(),
  )
  expect(Object.keys(STATE_SCENES).sort()).toEqual(['active', 'BLOCKED', 'done', 'stalled', 'stopped'].sort())
})

test('every scene draws at least one pixel and names a keyframe class', () => {
  for (const [name, scene] of Object.entries({ ...SCENES, ...STATE_SCENES })) {
    expect(scene.rects.length, `${name} has pixels`).toBeGreaterThan(0)
    expect(scene.className, `${name} names a class`).toMatch(/^av-/)
  }
})

test('captions count what the event carries, and stay singular at one', () => {
  expect(caption(ev({ kind: 'reflex', hits: 2 }))).toBe('injecting 2 rules')
  expect(caption(ev({ kind: 'reflex', hits: 1 }))).toBe('injecting 1 rule')
  expect(caption(ev({ kind: 'dispatch', hits: 3 }))).toBe('dispatching 3 children')
  expect(caption(ev({ kind: 'dispatch', hits: 1 }))).toBe('dispatching 1 child')
})

test('captions without a count ignore hits entirely', () => {
  expect(caption(ev({ kind: 'learned', hits: 1 }))).toBe('learned something')
  expect(caption(ev({ kind: 'enforce', hits: 9 }))).not.toContain('9')
})

test('a missing count falls back to a phrase that still reads', () => {
  expect(caption(ev({ kind: 'reflex', hits: undefined }))).toBe('injecting rules')
  expect(caption(ev({ kind: 'dispatch', hits: undefined }))).toBe('dispatching children')
})

test('parts are numbered within their own part, not by position in the list', () => {
  // dispatch lists its three children *after* body and arms; they must still be 0,1,2
  // so the CSS stagger reaches them. Numbering by list position would make them 11,12,13.
  const kids = withPartIndex(SCENES.dispatch.rects).filter(([rect]) => rect.part === 'object')
  expect(kids.map(([, n]) => n)).toEqual([0, 1, 2])

  // reflex lists its pages *first* — same numbers, different position.
  const pages = withPartIndex(SCENES.reflex.rects).filter(([rect]) => rect.part === 'object')
  expect(pages.map(([, n]) => n)).toEqual([0, 1, 2])
})
