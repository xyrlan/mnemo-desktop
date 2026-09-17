import { IDLE, SCENES, STATE_SCENES, caption, withPartIndex, type Rect } from './scenes'
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

test('idle is the plain body at rest, apart from every action and every child state', () => {
  expect(IDLE.className).toBe('av-idle')
  expect(IDLE.rects.some((r) => r.part === 'object')).toBe(false)
  expect(IDLE.rects.some((r) => r.part === 'head')).toBe(true)
  const taken = Object.values({ ...SCENES, ...STATE_SCENES }).map((s) => s.className)
  expect(taken).not.toContain(IDLE.className)
})

test('tool holds an object, so on the square it cannot pass for idle', () => {
  const objects = withPartIndex(SCENES.tool.rects).filter(([rect]) => rect.part === 'object')
  expect(objects.map(([, n]) => n)).toEqual([0, 1, 2])
  const key = (rects: typeof IDLE.rects) => rects.map((r) => `${r.part}:${r.x},${r.y},${r.w},${r.h}`).sort().join(' ')
  expect(key(SCENES.tool.rects)).not.toBe(key(IDLE.rects))
  // The thread and the reaching arm sit right of centre, clear of the arm band's top.
  for (const [rect] of objects) {
    expect(rect.x).toBeGreaterThanOrEqual(16)
    expect(rect.y + rect.h).toBeLessThanOrEqual(16)
  }
})

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const parts = (rects: Rect[], part: Rect['part']) => rects.filter((r) => r.part === part)

test('catchup and briefing keep clear of the head, so at rest he has a face and no hat', () => {
  for (const kind of ['catchup', 'briefing'] as const) {
    const rects = SCENES[kind].rects
    const body = [...parts(rects, 'head'), ...parts(rects, 'eye')]
    for (const object of parts(rects, 'object')) {
      for (const b of body) expect(overlaps(object, b), `${kind} object at ${object.x},${object.y}`).toBe(false)
    }
  }
})

test('the node learned stands apart from the ring it joins', () => {
  const rects = SCENES.learned.rects
  const ring = parts(rects, 'node')
  const learned = parts(rects, 'object')
  for (const object of learned) for (const node of ring) expect(overlaps(object, node)).toBe(false)
  // Bigger than any ring node, so it is findable once the pop has settled.
  const span = (rs: Rect[]) => Math.max(...rs.map((r) => r.x + r.w)) - Math.min(...rs.map((r) => r.x))
  expect(span(learned)).toBeGreaterThan(Math.max(...ring.map((n) => n.w)) * 2)
})
