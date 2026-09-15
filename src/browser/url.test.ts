import { normalizeUrl, displayUrl, BLANK } from './url'

test('full web urls pass through, normalised', () => {
  expect(normalizeUrl('https://github.com/o/r/pull/4')).toBe('https://github.com/o/r/pull/4')
  expect(normalizeUrl('  HTTP://Example.com ')).toBe('http://example.com/')
})

test('bare domains get https', () => {
  expect(normalizeUrl('github.com')).toBe('https://github.com/')
  expect(normalizeUrl('github.com/o/r/pulls?q=is:open')).toBe('https://github.com/o/r/pulls?q=is:open')
  expect(normalizeUrl('staging.example.io:8443/x')).toBe('https://staging.example.io:8443/x')
})

test('local dev servers get http', () => {
  expect(normalizeUrl('localhost:3000')).toBe('http://localhost:3000/')
  expect(normalizeUrl('localhost')).toBe('http://localhost/')
  expect(normalizeUrl('127.0.0.1:8080/api')).toBe('http://127.0.0.1:8080/api')
  expect(normalizeUrl('app.localhost:5173')).toBe('http://app.localhost:5173/')
  expect(normalizeUrl('devbox:4000')).toBe('http://devbox:4000/')
})

test('anything else is a search', () => {
  expect(normalizeUrl('tauri child webview')).toBe('https://www.google.com/search?q=tauri%20child%20webview')
  expect(normalizeUrl('react')).toBe('https://www.google.com/search?q=react')
})

test('empty input and refused schemes give null', () => {
  expect(normalizeUrl('   ')).toBeNull()
  expect(normalizeUrl('file:///etc/passwd')).toBeNull()
  expect(normalizeUrl('tauri://localhost/')).toBeNull()
})

test('about:blank is kept and shown as empty', () => {
  expect(normalizeUrl('about:blank')).toBe(BLANK)
  expect(displayUrl(BLANK)).toBe('')
  expect(displayUrl('https://x.dev/')).toBe('https://x.dev/')
})
