import { shaOfVersionLine, staleReminder, when } from './stale.mjs'

const at = (h, m) => new Date(2026, 8, 15, h, m)

test('a bundle behind main names when it was installed and how far behind it is', () => {
  expect(staleReminder({ at: at(10, 49), behind: 6 }, at(16, 35))).toBe(
    'bundle installed at 2026-09-15 10:49 is behind main (6 commits); run `pnpm run install-app`',
  )
  expect(staleReminder({ at: at(10, 49), behind: 1 }, at(16, 35))).toContain('(1 commit)')
})

test('nothing to say when the app is not installed or already carries the tip of main', () => {
  expect(staleReminder(null, at(16, 35))).toBeNull()
  expect(staleReminder({ at: at(10, 49), behind: 0 }, at(16, 35))).toBeNull()
})

test('a bundle that cannot say its commit falls back to its mtime against the merge', () => {
  expect(staleReminder({ at: at(10, 49), behind: null }, at(16, 35))).toBe(
    'bundle installed at 2026-09-15 10:49 is behind main; run `pnpm run install-app`',
  )
  expect(staleReminder({ at: at(16, 40), behind: null }, at(16, 35))).toBeNull()
})

test('the sha comes back out of the version line', () => {
  expect(shaOfVersionLine('mnemo-desktop 0.1.0 (9f3ab21, built 2026-09-15 13:49 UTC)')).toBe('9f3ab21')
  expect(shaOfVersionLine('mnemo-desktop 0.1.0 (unknown, built unknown)')).toBeNull()
  expect(shaOfVersionLine('')).toBeNull()
})

test('times are padded so they sort and read the same width', () => {
  expect(when(new Date(2026, 0, 2, 3, 4))).toBe('2026-01-02 03:04')
})
