import { IDLE_PUBLISH, localDate, publishReducer, type Publish, type PublishEvent } from './publish'

const run = (events: PublishEvent[], from: Publish = IDLE_PUBLISH) => events.reduce(publishReducer, from)

test('publish → Open PR goes through a confirmation before anything runs', () => {
  const published = run([{ type: 'start' }, { type: 'published', ok: true, output: 'published 2 rules' }])
  expect(published).toEqual({ status: 'published', ok: true, output: 'published 2 rules' })
  const confirming = publishReducer(published, { type: 'ask' })
  expect(confirming).toEqual({ status: 'confirming', output: 'published 2 rules' })
  expect(publishReducer(confirming, { type: 'cancel' })).toEqual(published)
  const opened = run([{ type: 'open' }, { type: 'opened', ok: true, output: '$ git push', url: 'https://pr/1', branch: 'team-rules/2026-09-15' }], confirming)
  expect(opened).toEqual({ status: 'opened', ok: true, output: '$ git push', url: 'https://pr/1', branch: 'team-rules/2026-09-15' })
})

test('Open PR can be asked for with no publish this session, and cancelled back to idle', () => {
  const c = publishReducer(IDLE_PUBLISH, { type: 'ask' })
  expect(c).toEqual({ status: 'confirming', output: '' })
  expect(publishReducer(c, { type: 'cancel' })).toEqual(IDLE_PUBLISH)
})

test('open only follows a confirmation, and busy flows ignore clicks and stale results', () => {
  expect(publishReducer(IDLE_PUBLISH, { type: 'open' })).toEqual(IDLE_PUBLISH)
  const failed = run([{ type: 'start' }, { type: 'published', ok: false, output: 'no vault' }])
  expect(publishReducer(failed, { type: 'ask' })).toBe(failed)
  const publishing: Publish = { status: 'publishing' }
  expect(publishReducer(publishing, { type: 'start' })).toBe(publishing)
  expect(publishReducer(publishing, { type: 'dismiss' })).toBe(publishing)
  expect(publishReducer(IDLE_PUBLISH, { type: 'published', ok: true, output: 'late' })).toBe(IDLE_PUBLISH)
  expect(publishReducer(IDLE_PUBLISH, { type: 'opened', ok: true, output: 'late' })).toBe(IDLE_PUBLISH)
  const opening: Publish = { status: 'opening', output: '' }
  expect(publishReducer(opening, { type: 'cancel' })).toBe(opening)
  expect(publishReducer(failed, { type: 'dismiss' })).toEqual(IDLE_PUBLISH)
})

test('the branch date is the local calendar date', () => {
  expect(localDate(new Date(2026, 8, 5, 23, 59))).toBe('2026-09-05')
})
