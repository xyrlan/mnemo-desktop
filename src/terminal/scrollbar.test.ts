// Read through Vite's `?raw` glob, not `node:fs`: `tsc` checks tests with the app's types, which
// have no Node modules.
const css = Object.values(import.meta.glob<string>('../chrome/chrome.css', { query: '?raw', import: 'default', eager: true }))[0]

test('the terminal viewport never scrolls sideways, only vertically', () => {
  expect(css).toMatch(/\.xterm-viewport\s*\{[^}]*overflow-x:\s*hidden/)
  expect(css).not.toMatch(/\.xterm-viewport\s*\{[^}]*overflow-y:\s*hidden/)
})
