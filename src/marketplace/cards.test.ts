import { cardReducer, IDLE, type Card } from './cards'

test('idle → importing → ok, then dismissed back to idle', () => {
  let c: Card = cardReducer(IDLE, { type: 'start', cwd: '/p' })
  expect(c).toEqual({ status: 'importing', cwd: '/p' })
  c = cardReducer(c, { type: 'done', ok: true, output: '4 staged' })
  expect(c).toEqual({ status: 'ok', cwd: '/p', output: '4 staged' })
  expect(cardReducer(c, { type: 'dismiss' })).toBe(IDLE)
})

test('importing → error keeps the output and the cwd it ran in', () => {
  const c = cardReducer(cardReducer(IDLE, { type: 'start', cwd: '/p' }), { type: 'done', ok: false, output: 'refused x' })
  expect(c).toEqual({ status: 'error', cwd: '/p', output: 'refused x' })
})

test('a second start while importing is ignored', () => {
  const c = cardReducer(IDLE, { type: 'start', cwd: '/p' })
  expect(cardReducer(c, { type: 'start', cwd: '/other' })).toBe(c)
  expect(cardReducer(c, { type: 'dismiss' })).toBe(c)
})

test('a result for a card that is not importing is dropped; a finished card can import again', () => {
  expect(cardReducer(IDLE, { type: 'done', ok: true, output: 'late' })).toBe(IDLE)
  const done: Card = { status: 'error', cwd: '/p', output: 'x' }
  expect(cardReducer(done, { type: 'done', ok: true, output: 'late' })).toBe(done)
  expect(cardReducer(done, { type: 'start', cwd: '/q' })).toEqual({ status: 'importing', cwd: '/q' })
})
