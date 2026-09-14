import { parseOsc7 } from './osc7'

test('parses file URL with host', () => {
  expect(parseOsc7('file://mac.local/Users/x/github')).toBe('/Users/x/github')
})
test('parses without host and decodes', () => {
  expect(parseOsc7('file:///tmp/a%20b')).toBe('/tmp/a b')
})
test('rejects other payloads', () => {
  expect(parseOsc7('nonsense')).toBeNull()
})
