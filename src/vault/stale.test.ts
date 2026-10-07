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

test('mnemo 1.7 findings: the page is the path, and the reason is the files it cites', () => {
  const out = JSON.stringify({
    project: 'app',
    ref: 'HEAD',
    pages_scanned: 159,
    stale_pages: 2,
    findings: [
      { slug: 'app__glob-import', page: '/v/shared/project/app__glob-import.md', missing: [{ span: 'src/tabs/view.tsx', path: 'src/tabs/view.tsx', line: null, moved_to: null }] },
      {
        slug: 'app__two',
        page: '/v/shared/project/app__two.md',
        missing: [
          { span: 'a.ts', path: 'a.ts', line: 3, moved_to: 'lib/a.ts' },
          { span: 'b.ts', path: 'b.ts', line: null, moved_to: null },
        ],
      },
    ],
  })
  expect(parseStale(out)).toEqual([
    { slug: 'app__glob-import', reason: 'cites a file gone at HEAD: src/tabs/view.tsx', path: '/v/shared/project/app__glob-import.md' },
    { slug: 'app__two', reason: 'cites files gone at HEAD: a.ts (now lib/a.ts), b.ts', path: '/v/shared/project/app__two.md' },
  ])
})

test('anything that is not that JSON is null', () => {
  for (const bad of ['', 'error: not a git repository', '{"ok": true}', '42']) expect(parseStale(bad)).toBeNull()
})
