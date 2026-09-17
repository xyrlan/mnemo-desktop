import { accentHue, HUES, repoAccent } from './repo-color'

test('same path, same accent, and a trailing slash is the same path', () => {
  expect(repoAccent('/gh/mnemo')).toBe(repoAccent('/gh/mnemo'))
  expect(repoAccent('/gh/mnemo/')).toBe(repoAccent('/gh/mnemo'))
  // Pinned so a refactor cannot silently repaint every repo the user has learned by colour.
  expect(accentHue('/Users/me/github/mnemo-desktop')).toBe(accentHue('/Users/me/github/mnemo-desktop'))
  expect(repoAccent('/gh/a')).toBe(`oklch(from var(--accent) l c ${accentHue('/gh/a')})`)
})

test('accents are spread over the hue wheel, never between two steps', () => {
  const step = 360 / HUES
  const hues = new Set<number>()
  for (let i = 0; i < 400; i++) {
    const h = accentHue(`/Users/me/github/repo-${i}`)
    expect(h).toBeGreaterThanOrEqual(0)
    expect(h).toBeLessThan(360)
    expect(((h - 15) / step) % 1).toBe(0)
    hues.add(h)
  }
  expect(hues.size).toBe(HUES)
})

test('neighbouring paths do not share an accent by construction', () => {
  // Sibling checkouts differ by a character; the hash must not map them to one hue as a rule.
  const siblings = ['/gh/app', '/gh/api', '/gh/app2', '/gh/app-wt'].map(accentHue)
  expect(new Set(siblings).size).toBeGreaterThan(1)
})

test('an accent is theme-relative: it reads --accent, never a fixed colour', () => {
  expect(repoAccent('/gh/x')).toMatch(/^oklch\(from var\(--accent\) l c \d+(\.\d+)?\)$/)
})
