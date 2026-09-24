import { formatDiffComments } from './format'
import type { DiffComment } from './comment'

const note = (over: Partial<DiffComment>): DiffComment => ({ id: 'x', worktreeId: '/w', filePath: 'a.ts', lineNumber: 1, body: 'b', createdAt: 0, ...over })

test('notes go out grouped by file, in the order files were first noted, each top to bottom', () => {
  const text = formatDiffComments([
    note({ filePath: 'src/b.ts', lineNumber: 40, body: 'second in b', createdAt: 1 }),
    note({ filePath: 'src/a.ts', lineNumber: 3, startLine: 1, body: 'range in a', quote: 'one\ntwo\nthree', createdAt: 2 }),
    note({ filePath: 'src/b.ts', lineNumber: 7, body: 'first in b', quote: 'const x = 1', createdAt: 3 }),
  ])
  expect(text).toBe(
    [
      'Review notes on the uncommitted changes (3 notes; line numbers are in the working copy):',
      '',
      'src/b.ts — line 7',
      '> const x = 1',
      'first in b',
      '',
      'src/b.ts — line 40',
      'second in b',
      '',
      'src/a.ts — lines 1-3',
      '> one',
      '> two',
      '> three',
      'range in a',
    ].join('\n'),
  )
})

test('a long quote is cut, saying how much was left out', () => {
  const quote = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n')
  const text = formatDiffComments([note({ quote })])
  expect(text).toContain('> l11\n> … (8 more lines)\nb')
  expect(text).not.toContain('> l12')
  expect(text.startsWith('Review notes on the uncommitted changes (1 note;')).toBe(true)
})

test('the file noted first comes first, whatever order the notes are handed in', () => {
  const text = formatDiffComments([note({ filePath: 'late.ts', body: 'second', createdAt: 5 }), note({ filePath: 'early.ts', body: 'first', createdAt: 1 })])
  expect(text.indexOf('early.ts')).toBeLessThan(text.indexOf('late.ts'))
})
