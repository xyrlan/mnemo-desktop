import { age, limitName, percentNow, resetsWhen, tightest, tone } from './format'
import { limit, NOW } from './testing'

test('a limit is named after its kind, and a scoped one after its model too', () => {
  expect(limitName({ kind: 'session', model: null })).toBe('Session')
  expect(limitName({ kind: 'weekly_all', model: null })).toBe('Weekly')
  expect(limitName({ kind: 'weekly_scoped', model: 'Fable' })).toBe('Weekly · Fable')
})

test('a kind the app does not know is named from its own words', () => {
  expect(limitName({ kind: 'monthly_opus_extra', model: null })).toBe('Monthly opus extra')
  expect(limitName({ kind: 'daily-burst', model: 'Opus' })).toBe('Daily burst · Opus')
  expect(limitName({ kind: '', model: null })).toBe('Limit')
})

test('a window whose reset has passed reads 0%', () => {
  expect(percentNow({ percent: 80, resetsAt: '2026-10-07T19:59:00Z' }, NOW)).toBe(0)
  expect(percentNow({ percent: 80, resetsAt: '2026-10-07T20:01:00Z' }, NOW)).toBe(80)
  expect(percentNow({ percent: 33.6, resetsAt: null }, NOW)).toBe(34)
  expect(percentNow({ percent: 140, resetsAt: null }, NOW)).toBe(100)
})

test('the tightest limit is the highest percent; on a tie, the active one', () => {
  const session = limit('session', 34)
  const weekly = limit('weekly_all', 36, { active: true })
  const scoped = limit('weekly_scoped', 0, { model: 'Fable' })
  expect(tightest([session, weekly, scoped], NOW)).toBe(weekly)
  expect(tightest([limit('session', 50), limit('weekly_all', 50, { active: true })], NOW)?.kind).toBe('weekly_all')
  expect(tightest([limit('session', 90, { resetsAt: '2026-10-07T19:00:00Z' }), weekly], NOW)).toBe(weekly)
  expect(tightest([], NOW)).toBeUndefined()
})

test('severity paints by what it says; a word it does not know is neutral', () => {
  expect(tone('normal')).toBe('ok')
  expect(tone('warning')).toBe('warn')
  expect(tone('critical')).toBe('bad')
  expect(tone('limit_reached')).toBe('bad')
  expect(tone('quantum')).toBe('unknown')
})

test('when a window resets: minutes and hours, then the local day and time', () => {
  expect(resetsWhen(null, NOW)).toBeNull()
  expect(resetsWhen('garbage', NOW)).toBeNull()
  expect(resetsWhen('2026-10-07T19:00:00Z', NOW)).toBe('reset')
  expect(resetsWhen('2026-10-07T20:00:30Z', NOW)).toBe('in under a minute')
  expect(resetsWhen('2026-10-07T20:45:00Z', NOW)).toBe('in 45 m')
  expect(resetsWhen('2026-10-07T23:20:00Z', NOW)).toBe('in 3 h 20 m')
  expect(resetsWhen('2026-10-08T00:00:00Z', NOW)).toBe('in 4 h')
  const later = new Date(2026, 9, 13, 13, 5)
  expect(resetsWhen(later.toISOString(), NOW)).toBe('Tue 13:05')
})

test('how old a reading is', () => {
  expect(age(NOW - 10_000, NOW)).toBe('just now')
  expect(age(NOW - 5 * 60_000, NOW)).toBe('5 m ago')
  expect(age(NOW - 2 * 3600_000, NOW)).toBe('2 h ago')
  expect(age(NOW - 3 * 86400_000, NOW)).toBe('3 d ago')
})
