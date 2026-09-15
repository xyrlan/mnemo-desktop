import { parseStale } from './stale'

test('a bare list of rows takes slug, reason and path from the usual keys', () => {
  const out = JSON.stringify([
    { slug: 'run-tests', reason: 'cited symbol gone: runTests', path: '/v/shared/feedback/run-tests.md' },
    { rule: 'mnemo__old', why: 'file deleted' },
    'plain-slug',
    { nothing: 1 },
  ])
  expect(parseStale(out)).toEqual([
    { slug: 'run-tests', reason: 'cited symbol gone: runTests', path: '/v/shared/feedback/run-tests.md' },
    { slug: 'mnemo__old', reason: 'file deleted', path: null },
    { slug: 'plain-slug', reason: '', path: null },
  ])
})

test('an object holding the list works, and a row with no reason key lists its scalars', () => {
  expect(parseStale('{"checked": 12, "stale": [{"slug": "x", "symbols": 3, "ref": "HEAD", "files": ["a"]}]}')).toEqual([
    { slug: 'x', reason: 'symbols 3 · ref HEAD', path: null },
  ])
  expect(parseStale('{"count": 0, "items": []}')).toEqual([])
})

test('anything that is not that JSON is null', () => {
  for (const bad of ['', 'error: not a git repository', '{"ok": true}', '42']) expect(parseStale(bad)).toBeNull()
})
