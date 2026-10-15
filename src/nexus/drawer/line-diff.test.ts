import { counts, hunks, lineDiff } from './line-diff'

test('a line diff keeps, removes and adds lines in order', () => {
  const d = lineDiff('a\nb\nc\nd', 'a\nB\nc\nd\ne')
  expect(d.map((l) => l.sign + l.text)).toEqual([' a', '-b', '+B', ' c', ' d', '+e'])
  expect(counts(d)).toEqual({ added: 2, removed: 1 })
})

test('a new file is all added, a deleted one all removed', () => {
  expect(lineDiff('', 'x\ny').map((l) => l.sign)).toEqual(['+', '+'])
  expect(lineDiff('x', '').map((l) => l.sign)).toEqual(['-'])
})

test('hunks keep three lines around each change and count what they skip', () => {
  const a = Array.from({ length: 20 }, (_, i) => `l${i}`)
  const b = [...a]
  b[10] = 'changed'
  const h = hunks(lineDiff(a.join('\n'), b.join('\n')))
  expect(h).toHaveLength(1)
  expect(h[0].skipped).toBe(7)
  expect(h[0].lines.map((l) => l.text)).toEqual(['l7', 'l8', 'l9', 'l10', 'changed', 'l11', 'l12', 'l13'])
})
