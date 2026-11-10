import type { ChangedFile } from '../../diff/client'
import type { DiffComment } from '../../diff/comment'
import { absolute, actOf, blocksOf, capped, isGone, linesOf, movedFile, notesByLine, pairsOf, quoteOf, rangeOf } from './model'

const file = (path: string): ChangedFile => ({ path, oldPath: null, status: 'modified', additions: 1, deletions: 1, binary: false })
const text = (...lines: string[]) => lines.join('\n') + '\n'
const letters = (from: string, n: number) => Array.from({ length: n }, (_, i) => `${from}${i + 1}`)

describe('a file\'s two sides as numbered lines', () => {
  test('each line carries its number on the side it is on: a removed one only before, an added one only now', () => {
    const lines = linesOf(text('a', 'b', 'c'), text('a', 'B', 'c', 'd'))
    expect(lines.map((l) => [l.sign, l.text, l.old, l.now])).toEqual([
      [' ', 'a', 1, 1],
      ['-', 'b', 2, null],
      ['+', 'B', null, 2],
      [' ', 'c', 3, 3],
      ['+', 'd', null, 4],
    ])
  })

  test('the newline that ends a file is not one more line', () => {
    expect(linesOf('', text('one', 'two')).map((l) => l.now)).toEqual([1, 2])
    expect(linesOf(text('one'), '').map((l) => [l.sign, l.old])).toEqual([['-', 1]])
    // A blank line inside the file is a line.
    expect(linesOf('', 'one\n\ntwo\n').map((l) => l.text)).toEqual(['one', '', 'two'])
  })
})

describe('what is drawn of a diff', () => {
  const before = text(...letters('k', 20))
  const after = text(...letters('k', 9), 'changed', ...letters('k', 20).slice(10))
  const lines = linesOf(before, after)

  test('a change with three kept lines either side; what is left out before and after is counted', () => {
    const b = blocksOf(lines)
    expect(b.blocks.length).toBe(1)
    expect(b.blocks[0].skipped).toBe(6)
    expect(b.blocks[0].lines.map((l) => l.text)).toEqual(['k7', 'k8', 'k9', 'k10', 'changed', 'k11', 'k12', 'k13'])
    expect(b.tail).toBe(7)
    expect([b.added, b.removed]).toEqual([1, 1])
  })

  test('two changes far apart are two blocks, with the lines between them counted on the second', () => {
    const two = linesOf(before, text('new', ...letters('k', 20).slice(1, 19), 'end'))
    const b = blocksOf(two)
    expect(b.blocks.map((x) => [x.skipped, x.lines.length])).toEqual([
      [0, 5],
      [12, 5],
    ])
    expect(b.tail).toBe(0)
  })

  test('a fold that is opened is drawn whole, and only that one', () => {
    const b = blocksOf(lines)
    const opened = blocksOf(lines, new Set(), new Set([b.blocks[0].fold]))
    expect(opened.blocks.length).toBe(1)
    expect(opened.blocks[0].skipped).toBe(0)
    expect(opened.blocks[0].lines[0].text).toBe('k1')
    expect(opened.tail).toBe(7)
    const tail = blocksOf(lines, new Set(), new Set([b.tailFold]))
    expect(tail.tail).toBe(0)
    expect(tail.blocks[0].skipped).toBe(6)
    expect(tail.blocks[0].lines.at(-1)!.text).toBe('k20')
  })

  test('a line a note stands on is drawn even when nothing near it changed', () => {
    const b = blocksOf(lines, new Set([18]))
    expect(b.blocks.map((x) => x.lines.map((l) => l.now))).toEqual([[7, 8, 9, null, 10, 11, 12, 13], [18]])
    expect(b.blocks[1].skipped).toBe(4)
    expect(b.tail).toBe(2)
  })

  test('a file changed in more lines than are drawn says how many are left', () => {
    const big = blocksOf(linesOf('', text(...letters('n', 40))))
    const cut = capped(big.blocks, 25)
    expect(cut.blocks[0].lines.length).toBe(25)
    expect(cut.left).toBe(15)
    expect(capped(big.blocks, 100)).toEqual({ blocks: big.blocks, left: 0 })
  })

  test('side by side, a kept line is on both sides and removed lines stand beside the added ones that replaced them', () => {
    const pairs = pairsOf(linesOf(text('a', 'b', 'c', 'd'), text('a', 'B', 'C', 'X', 'd')))
    expect(pairs.map((p) => [p.left?.text ?? null, p.right?.text ?? null])).toEqual([
      ['a', 'a'],
      ['b', 'B'],
      ['c', 'C'],
      [null, 'X'],
      ['d', 'd'],
    ])
    const gone = pairsOf(linesOf(text('a', 'b'), text('a')))
    expect(gone.map((p) => [p.left?.text ?? null, p.right?.text ?? null])).toEqual([
      ['a', 'a'],
      ['b', null],
    ])
  })
})

describe('what a key does', () => {
  test('arrows walk the files, V lays the diff the other way, U reads again, O opens the file, S sends the notes', () => {
    expect(actOf({ key: 'ArrowDown' })).toEqual({ kind: 'move', by: 1 })
    expect(actOf({ key: 'k' })).toEqual({ kind: 'move', by: -1 })
    expect(actOf({ key: 'V' })).toEqual({ kind: 'layout' })
    expect(actOf({ key: 'u' })).toEqual({ kind: 'read' })
    expect(actOf({ key: 'o' })).toEqual({ kind: 'open' })
    expect(actOf({ key: 's' })).toEqual({ kind: 'send' })
    expect(actOf({ key: 's', ctrlKey: true })).toBeNull()
    expect(actOf({ key: 'Enter' })).toBeNull()
  })

  test('the files are walked in the order listed, stopping at the ends', () => {
    const files = [file('a'), file('b'), file('c')]
    expect(movedFile(files, 'a', 1)).toBe('b')
    expect(movedFile(files, 'c', 1)).toBe('c')
    expect(movedFile(files, 'a', -1)).toBe('a')
    expect(movedFile(files, 'gone', 1)).toBe('a')
    expect(movedFile([], 'a', 1)).toBeNull()
  })
})

describe('notes', () => {
  test('a note is on the line clicked; with shift it runs from the line it was started on, in either direction', () => {
    expect(rangeOf(null, 12, false)).toEqual({ lineNumber: 12 })
    expect(rangeOf(10, 12, false)).toEqual({ lineNumber: 12 })
    expect(rangeOf(10, 12, true)).toEqual({ startLine: 10, lineNumber: 12 })
    expect(rangeOf(12, 10, true)).toEqual({ startLine: 10, lineNumber: 12 })
    expect(rangeOf(null, 12, true)).toEqual({ lineNumber: 12 })
    expect(rangeOf(12, 12, true)).toEqual({ lineNumber: 12 })
  })

  test('a note quotes the lines it covers as they read now, never a removed one', () => {
    const lines = linesOf(text('a', 'b', 'c'), text('a', 'B', 'c'))
    expect(quoteOf(lines, 2, 3)).toBe('B\nc')
    expect(quoteOf(lines, 1, 1)).toBe('a')
  })

  test('a file\'s notes are drawn under the last line each covers, oldest first; another file\'s are not its', () => {
    const note = (id: string, filePath: string, lineNumber: number): DiffComment => ({ id, worktreeId: '/wt', filePath, lineNumber, body: id, createdAt: 0 })
    const by = notesByLine([note('n1', 'a.ts', 4), note('n2', 'b.ts', 4), note('n3', 'a.ts', 4), note('n4', 'a.ts', 9)], 'a.ts')
    expect([...by.entries()].map(([line, list]) => [line, list.map((c) => c.id)])).toEqual([
      [4, ['n1', 'n3']],
      [9, ['n4']],
    ])
  })
})

test('a worktree that is gone is told from any other failure to read it', () => {
  expect(isGone('git: No such file or directory (os error 2)')).toBe(true)
  expect(isGone('fatal: not a git repository')).toBe(true)
  expect(isGone('git timed out after 30s')).toBe(false)
})

test('a file is opened by its place in the worktree', () => {
  expect(absolute('/code/wt/', 'src/a.ts')).toBe('/code/wt/src/a.ts')
  expect(absolute('C:\\code\\wt\\', 'src/a.ts')).toBe('C:\\code\\wt/src/a.ts')
})
