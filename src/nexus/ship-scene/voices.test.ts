import { FRESH_MS, pickVoices, TURN_MS, type Voice } from './voices'

const ids = ['a', 'b', 'c', 'd']
const stale = () => -1e9

test('the first voices are the first robots on the floor', () => {
  expect(pickVoices([], ids, stale, 2, 0, true).map((v) => v.id)).toEqual(['a', 'b'])
  expect(pickVoices([], ids, stale, 0, 0, true)).toEqual([])
  expect(pickVoices([], [], stale, 2, 0, true)).toEqual([])
})

test('a line that just changed takes the floor from the voice that has spoken longest', () => {
  const prev: Voice[] = [
    { id: 'a', at: 100 },
    { id: 'b', at: 50 },
  ]
  const said = (id: string) => (id === 'd' ? 1_000 : -1e9)
  const next = pickVoices(prev, ids, said, 2, 1_000 + FRESH_MS - 1, true)
  expect(next.map((v) => v.id).sort()).toEqual(['a', 'd'])
})

test('the rest take turns every TURN_MS, in floor order, and only while turns are taken', () => {
  let cur = pickVoices([], ids, stale, 2, 0, true)
  cur = pickVoices(cur, ids, stale, 2, TURN_MS - 1, true)
  expect(cur.map((v) => v.id).sort()).toEqual(['a', 'b'])
  cur = pickVoices(cur, ids, stale, 2, TURN_MS, true)
  expect(cur.map((v) => v.id).sort()).toEqual(['b', 'c'])
  expect(
    pickVoices(cur, ids, stale, 2, 10 * TURN_MS, false)
      .map((v) => v.id)
      .sort(),
  ).toEqual(['b', 'c'])
})

test('a robot that left the room stops speaking and another takes its place', () => {
  const cur = pickVoices(
    [
      { id: 'x', at: 0 },
      { id: 'a', at: 0 },
    ],
    ids,
    stale,
    2,
    1,
    true,
  )
  expect(cur.map((v) => v.id).sort()).toEqual(['a', 'b'])
})

test('everyone speaks when the room has a voice for each', () => {
  const two = ['a', 'b']
  expect(
    pickVoices(pickVoices([], two, stale, 3, 0, true), two, stale, 3, 5 * TURN_MS, true)
      .map((v) => v.id)
      .sort(),
  ).toEqual(['a', 'b'])
})
