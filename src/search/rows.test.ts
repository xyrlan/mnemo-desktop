import type { SearchResult } from './client'
import { buildSearchRows, matchParts, splitPath } from './rows'

const m = (line: number, lineContent = 'x', column = 1, matchLength = 1) => ({ line, column, matchLength, lineContent })
const results: SearchResult = {
  files: [
    { filePath: '/r/a.ts', relativePath: 'a.ts', matches: [m(1), m(4)] },
    { filePath: '/r/src/b.ts', relativePath: 'src/b.ts', matches: [m(2)] },
  ],
  totalMatches: 3,
  truncated: false,
  timedOut: false,
}

describe('search rows', () => {
  it('flattens files and their matches, leaving out a folded file’s matches', () => {
    const shape = (s: ReadonlySet<string>) => buildSearchRows(results, s).map((r) => (r.type === 'file' ? `${r.fileResult.relativePath}${r.collapsed ? '+' : ''}` : `  ${r.match.line}#${r.matchIndex}`))
    expect(shape(new Set())).toEqual(['a.ts', '  1#0', '  4#1', 'src/b.ts', '  2#0'])
    expect(shape(new Set(['/r/a.ts']))).toEqual(['a.ts+', 'src/b.ts', '  2#0'])
    expect(buildSearchRows(null, new Set())).toEqual([])
  })

  it('splits a line around its match, cutting a long start from the left', () => {
    expect(matchParts(m(1, '  const foo = 1', 9, 3))).toEqual({ before: 'const ', match: 'foo', after: ' = 1' })
    const long = `${'a'.repeat(40)}foo;`
    expect(matchParts(m(1, long, 41, 3))).toEqual({ before: `…${'a'.repeat(26)}`, match: 'foo', after: ';' })
    // A cut line places the match by its display column.
    expect(matchParts({ ...m(1, 'xxfooyy', 900, 3), displayColumn: 3, displayMatchLength: 3 })).toEqual({ before: 'xx', match: 'foo', after: 'yy' })
    // A column past the line shows the line unhighlighted.
    expect(matchParts(m(1, 'abc', 3, 5))).toEqual({ before: 'abc', match: '', after: '' })
  })

  it('splits a path into its name and folder', () => {
    expect(splitPath('src/deep/b.ts')).toEqual({ name: 'b.ts', dir: 'src/deep' })
    expect(splitPath('README.md')).toEqual({ name: 'README.md', dir: '' })
  })
})
