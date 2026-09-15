import { childrenOf, fmtTokens, parentTokenLine, parentTokens } from './tokens'
import { desktop, mnemo, parent } from './fixtures'

test('fmtTokens uses k and M', () => {
  expect(fmtTokens(0)).toBe('0')
  expect(fmtTokens(950)).toBe('950')
  expect(fmtTokens(1_234)).toBe('1.2k')
  expect(fmtTokens(12_400)).toBe('12k')
  expect(fmtTokens(210_000)).toBe('210k')
  expect(fmtTokens(999_999)).toBe('1M')
  expect(fmtTokens(1_240_000)).toBe('1.2M')
  expect(fmtTokens(64_000_000)).toBe('64M')
  expect(fmtTokens(NaN)).toBe('0')
})

test('parent token fields read as 0 when the snapshot predates them', () => {
  const old = parent({ session_id: 'x' })
  expect(parentTokens(old)).toEqual({ tokens: 0, cacheRead: 0, children: 0 })
  expect(parentTokenLine(old)).toBeNull()
  expect(parentTokens({ ...old, tokens: 'junk' as never })).toEqual({ tokens: 0, cacheRead: 0, children: 0 })
})

test('parent token line', () => {
  expect(parentTokenLine(desktop.parents[0])).toBe('parent 210k · children 640k')
  expect(parentTokenLine(parent({ session_id: 'x', tokens: 1_500 }))).toBe('parent 1.5k · children 0')
})

test('childrenOf follows parent_session across missions and loose children', () => {
  expect(childrenOf(desktop, '0ff9d810-aaaa').map((c) => c.id)).toEqual(['a43d3832', '094c6a03'])
  expect(childrenOf(mnemo, '812d9d86-bbbb')).toEqual([])
})
