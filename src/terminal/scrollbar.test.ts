// The stylesheet that ships, read off disk the way parse.test.ts reads its fixtures: `tsc` checks
// tests with the app's types (no Node modules), and vitest hands a `?raw` CSS import back empty.
type Fs = { readFileSync(path: string, encoding: string): string }
const terminalCss = 'src/terminal/terminal.css'

test('the terminal viewport never scrolls sideways, only vertically', async () => {
  const fs = (await import(/* @vite-ignore */ 'node:' + 'fs')) as unknown as Fs
  const css = fs.readFileSync(terminalCss, 'utf8')
  expect(css).toMatch(/\.xterm-viewport\s*\{[^}]*overflow-x:\s*hidden/)
  expect(css).not.toMatch(/\.xterm-viewport\s*\{[^}]*overflow-y:\s*hidden/)
})

test('the viewport shows the terminal background and no native scrollbar of its own', async () => {
  const fs = (await import(/* @vite-ignore */ 'node:' + 'fs')) as unknown as Fs
  const css = fs.readFileSync(terminalCss, 'utf8')
  // xterm paints the viewport black inline; only an !important rule wins over that.
  expect(css).toMatch(/\.xterm-viewport\s*\{[^}]*background-color:\s*var\(--bg\)\s*!important/)
  expect(css).toMatch(/\.xterm-viewport\s*\{[^}]*scrollbar-width:\s*none/)
  expect(css).toMatch(/\.xterm-viewport::-webkit-scrollbar\s*\{\s*display:\s*none/)
})

test('the terminal brings its own layout and messages: the drawer draws it with no workbench pane around it', async () => {
  const fs = (await import(/* @vite-ignore */ 'node:' + 'fs')) as unknown as Fs
  const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')
  const css = strip(fs.readFileSync(terminalCss, 'utf8'))
  const chrome = strip(fs.readFileSync('src/chrome/chrome.css', 'utf8'))
  for (const cls of ['pane-body', 'terminal-body', 'pane-message', 'pane-notice']) {
    expect(css).toMatch(new RegExp(`\\.${cls}\\s*\\{`))
    expect(chrome).not.toMatch(new RegExp(`\\.${cls}\\b`))
  }
  // No rule waits for a workbench `.pane` around the terminal.
  expect(css).not.toMatch(/\.pane\s/)
  expect(fs.readFileSync('src/terminal/view.tsx', 'utf8')).toMatch(/^import '\.\/terminal\.css'$/m)
})
