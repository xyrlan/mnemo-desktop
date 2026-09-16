import { estimateUsd, fmtUsd } from './cost'

test('cost scales by model family and defaults to the dearest', () => {
  expect(estimateUsd(1_000_000, 'claude-haiku-4-5')).toBe(2.5)
  expect(estimateUsd(1_000_000, 'sonnet')).toBe(9)
  expect(estimateUsd(1_000_000, null)).toBe(30)
  expect(fmtUsd(0.001)).toBe('<$0.01')
  expect(fmtUsd(1.234)).toBe('$1.23')
})

test('a real model string from mnemo sessions prices at its own family, not the fallback', () => {
  expect(estimateUsd(1_000_000, 'haiku')).toBe(2.5)
  expect(estimateUsd(1_000_000, 'opus[1m]')).toBe(30)
  expect(estimateUsd(1_000_000, 'claude-sonnet-5')).toBe(9)
  expect(estimateUsd(1_000_000, 'haiku')).toBeLessThan(estimateUsd(1_000_000, null))
})
