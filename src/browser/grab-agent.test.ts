import { expect, test } from 'vitest'
import { pasteOf } from './grab-agent'

test('a paste cannot end itself early or press keys', () => {
  expect(pasteOf('a\r\nb\x1b[201~\x03c\td')).toBe('\x1b[200~a\nb[201~c\td\x1b[201~')
})
