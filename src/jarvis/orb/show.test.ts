import type { VoicePhase } from '../client'
import { HIDDEN, LINGER_MS, lookOf, stepShow, type Shown } from './show'

test('each phase has its look, and an idle voice shows only while a request is worked on', () => {
  expect(lookOf('listening', false)).toBe('listening')
  expect(lookOf('transcribing', false)).toBe('thinking')
  expect(lookOf('speaking', true)).toBe('speaking')
  expect(lookOf('waiting', false)).toBe('waiting')
  expect(lookOf('idle', true)).toBe('thinking')
  expect(lookOf('idle', false)).toBeNull()
})

/** Runs `steps` of [ms since start, voice, busy] and returns whether the orb was up after each. */
const run = (steps: [number, VoicePhase, boolean][]) => {
  let s: Shown = HIDDEN
  return steps.map(([t, voice, busy]) => {
    s = stepShow(s, lookOf(voice, busy), t)
    return s.shown
  })
}

test('a take by the key: up from listening, through thinking and speaking, gone after the linger', () => {
  expect(
    run([
      [0, 'idle', false],
      [100, 'listening', false],
      [2000, 'transcribing', false],
      // Whisper is done and the loop has not taken the request yet: still up.
      [2600, 'idle', false],
      [2650, 'idle', true],
      [5000, 'speaking', true],
      [8000, 'idle', false],
      [8000 + LINGER_MS - 1, 'idle', false],
      [8000 + LINGER_MS, 'idle', false],
    ]),
  ).toEqual([false, true, true, true, true, true, true, true, false])
})

test('a hands-free conversation stays up through the follow-up window and its next take', () => {
  expect(
    run([
      [0, 'listening', false],
      [1000, 'transcribing', false],
      [1500, 'idle', true],
      [3000, 'speaking', true],
      [6000, 'waiting', false],
      [9000, 'listening', false],
      [11000, 'speaking', true],
      [13000, 'waiting', false],
      // The window closed in silence.
      [21000, 'idle', false],
      [21000 + LINGER_MS, 'idle', false],
    ]),
  ).toEqual([true, true, true, true, true, true, true, true, true, false])
})

test('a look within the linger keeps the same conversation, and its start', () => {
  let s = stepShow(HIDDEN, 'listening', 100)
  s = stepShow(s, null, 1000)
  expect(s).toEqual({ shown: true, since: 100, overAt: 1000 })
  s = stepShow(s, 'thinking', 1200)
  expect(s).toEqual({ shown: true, since: 100, overAt: null })
  // Over again: the linger starts from this end, not the first.
  s = stepShow(s, null, 3000)
  expect(stepShow(s, null, 1000 + LINGER_MS).shown).toBe(true)
  expect(stepShow(s, null, 3000 + LINGER_MS)).toEqual(HIDDEN)
})

test('a new conversation after the orb went starts afresh', () => {
  let s = stepShow(HIDDEN, 'listening', 0)
  s = stepShow(s, null, 10)
  s = stepShow(s, null, 10 + LINGER_MS)
  expect(s).toEqual(HIDDEN)
  expect(stepShow(s, 'listening', 9000)).toEqual({ shown: true, since: 9000, overAt: null })
})

test('the same input gives back the same state, so nothing is re-sent', () => {
  const s = stepShow(HIDDEN, 'speaking', 0)
  expect(stepShow(s, 'speaking', 50)).toBe(s)
  const over = stepShow(s, null, 100)
  expect(stepShow(over, null, 200)).toBe(over)
  expect(stepShow(HIDDEN, null, 300)).toBe(HIDDEN)
})
