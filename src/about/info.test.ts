import { aboutLine } from './info'

test('the about line names the version, the commit and when it was built', () => {
  expect(aboutLine({ version: '0.1.0', sha: '9f3ab21', built_at: '2026-09-15 13:49 UTC' })).toBe(
    'mnemo 0.1.0 · 9f3ab21 · built 2026-09-15 13:49 UTC',
  )
})

test('parts the build could not stamp are dropped, not shown as unknown', () => {
  expect(aboutLine({ version: '0.1.0', sha: 'unknown', built_at: 'unknown' })).toBe('mnemo 0.1.0')
  expect(aboutLine({ version: '0.1.0', sha: '', built_at: '2026-09-15 13:49 UTC' })).toBe('mnemo 0.1.0 · built 2026-09-15 13:49 UTC')
})

test('no answer from the app is an empty line, not a broken one', () => {
  expect(aboutLine(null)).toBe('')
})
