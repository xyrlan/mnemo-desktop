import { externalUrl } from './open'

test('only web pages go to the system browser', () => {
  expect(externalUrl('https://github.com/o/r/pull/4')).toBe('https://github.com/o/r/pull/4')
  expect(externalUrl('http://localhost:3000')).toBe('http://localhost:3000/')
  expect(externalUrl('about:blank')).toBeNull()
  expect(externalUrl('')).toBeNull()
  expect(externalUrl('github.com')).toBeNull()
  expect(externalUrl('file:///etc/passwd')).toBeNull()
  expect(externalUrl('javascript:alert(1)')).toBeNull()
})
