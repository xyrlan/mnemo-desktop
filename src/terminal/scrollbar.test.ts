import { readFileSync } from 'node:fs'

// A variable path, not a literal `new URL(…, import.meta.url)`, which Vite would rewrite.
const chromeCss = 'src/chrome/chrome.css'

test('the terminal viewport never scrolls sideways, only vertically', () => {
  const css = readFileSync(chromeCss, 'utf8')
  expect(css).toMatch(/\.xterm-viewport\s*\{[^}]*overflow-x:\s*hidden/)
  expect(css).not.toMatch(/\.xterm-viewport\s*\{[^}]*overflow-y:\s*hidden/)
})
