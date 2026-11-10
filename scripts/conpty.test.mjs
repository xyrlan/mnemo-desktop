// @vitest-environment node
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

/** The Windows installer puts Windows Terminal's pseudoconsole beside the app (src-tauri/vendor/conpty):
 *  portable-pty loads a `conpty.dll` found there, and that one starts `x64/OpenConsole.exe` beside
 *  itself. Without it a pane runs on Windows 10's own, which keeps no scrollback for the wheel. */
const conf = JSON.parse(readFileSync('src-tauri/tauri.windows.conf.json', 'utf8'))
const readme = readFileSync('src-tauri/vendor/conpty/README.md', 'utf8')

test('the installer puts conpty.dll beside the app and OpenConsole.exe in the x64 folder beside it', () => {
  expect(conf.bundle.resources).toMatchObject({
    'vendor/conpty/conpty.dll': 'conpty.dll',
    'vendor/conpty/x64/OpenConsole.exe': 'x64/OpenConsole.exe',
  })
})

test('the vendored files are the ones the README names', () => {
  for (const file of ['conpty.dll', 'x64/OpenConsole.exe']) {
    const sum = createHash('sha256').update(readFileSync(`src-tauri/vendor/conpty/${file}`)).digest('hex')
    expect(readme).toContain(`${sum}  ${file}`)
  }
})
