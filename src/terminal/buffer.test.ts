import { describe, expect, it } from 'vitest'
import { bufferLines, readBuffer, registerBuffer, tail, type RowBuffer } from './buffer'

/** Rows as xterm stores them: fixed width, padded with spaces; `+` marks a wrapped row. */
function rows(...spec: string[]): RowBuffer {
  const lines = spec.map((s) => ({
    isWrapped: s.startsWith('+'),
    translateToString: (trim?: boolean) => {
      const t = s.replace(/^\+/, '').padEnd(10, ' ')
      return trim ? t.trimEnd() : t
    },
  }))
  return { length: lines.length, getLine: (y) => lines[y] }
}

describe('buffer registry', () => {
  it('reads a registered pane and forgets it on unregister', () => {
    const off = registerBuffer(7, () => ['$ ls', 'a b'])
    expect(readBuffer(7)).toEqual(['$ ls', 'a b'])
    off()
    expect(readBuffer(7)).toBeUndefined()
  })

  it('a stale unregister leaves the newer reader in place', () => {
    const first = registerBuffer(8, () => ['old'])
    registerBuffer(8, () => ['new'])
    first()
    expect(readBuffer(8)).toEqual(['new'])
  })
})

describe('tail', () => {
  it('drops the blank rows under the prompt before counting', () => {
    expect(tail(['a', 'b', 'c', '', '  '], 2)).toEqual(['b', 'c'])
  })

  it('returns everything when fewer lines exist, nothing for n <= 0', () => {
    expect(tail(['a'], 50)).toEqual(['a'])
    expect(tail(['a', 'b'], 0)).toEqual([])
    expect(tail([], 5)).toEqual([])
  })
})

describe('bufferLines', () => {
  it('joins soft-wrapped rows and keeps the spaces at the wrap point', () => {
    expect(bufferLines(rows('$ echo hel', '+lo world', 'hello'))).toEqual(['$ echo hello world', 'hello'])
  })

  it('right-trims every logical line end, not the padding before a wrap', () => {
    expect(bufferLines(rows('a', 'b'))).toEqual(['a', 'b'])
    expect(bufferLines(rows('foo', '+bar'))).toEqual(['foo       bar'])
  })

  it('a wrapped first row starts its own line', () => {
    expect(bufferLines(rows('+tail'))).toEqual(['tail'])
  })
})
