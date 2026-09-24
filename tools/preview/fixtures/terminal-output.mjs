// What a terminal pane shows in the `terminal-pane` scenario: a zsh session in the repo, with
// the colours and line endings a real pty sends.

const ESC = '\x1b['
const c = (code, s) => `${ESC}${code}m${s}${ESC}0m`
const prompt = `${c('1;36', 'mnemo-desktop')} ${c('35', 'main')} ${c('32', '❯')} `

export const TERMINAL_OUTPUT = [
  `${prompt}git status --short --branch`,
  `## main...origin/main`,
  ` ${c('31', 'M')} src/layout/store.ts`,
  `${c('31', '??')} tools/preview/`,
  `${prompt}pnpm test`,
  ``,
  ` ${c('7;36', ' RUN ')} ${c('36', 'v5.0.0')} ${c('2', '/Users/preview/code/mnemo-desktop')}`,
  ``,
  ` ${c('32', '✓')} src/layout/store.test.ts ${c('2', '(48 tests)')} ${c('33', '412ms')}`,
  ` ${c('32', '✓')} src/terminal/buffer.test.ts ${c('2', '(12 tests)')} ${c('33', '38ms')}`,
  ` ${c('32', '✓')} src/home/Home.test.tsx ${c('2', '(21 tests)')} ${c('33', '1.21s')}`,
  ``,
  ` ${c('2', 'Test Files')}  ${c('1;32', '124 passed')} ${c('2', '(124)')}`,
  `      ${c('2', 'Tests')}  ${c('1;32', '957 passed')} ${c('2', '|')} ${c('33', '1 skipped')} ${c('2', '(958)')}`,
  `   ${c('2', 'Duration')}  14.62s`,
  ``,
  prompt,
].join('\r\n')
