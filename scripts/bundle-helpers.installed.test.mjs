import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { APP_BIN, HELPERS, checkInstalled, missingInstalled } from './bundle-helpers.mjs'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'bundle-helpers.mjs')

/** What the NSIS installer leaves in `%LOCALAPPDATA%\mnemo`. */
const INSTALLED = ['mnemo-desktop-hook.exe', 'mnemo-desktop-mcp.exe', 'mnemo-desktop-ptyd.exe', 'mnemo-desktop.exe', 'uninstall.exe']

const folder = (names) => {
  const dir = mkdtempSync(join(tmpdir(), 'bundle-installed-'))
  for (const n of names) writeFileSync(join(dir, n), '')
  return dir
}

const run = (...args) => {
  try {
    return { code: 0, out: execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
  } catch (e) {
    return { code: e.status, out: `${e.stdout}${e.stderr}` }
  }
}

test('a Windows install needs each helper as an .exe beside the app', () => {
  expect(missingInstalled(INSTALLED)).toEqual([])
  // The MCP bridge and the hook are what a Windows app starts now; an install without them
  // has neither the desktop tools nor agent events.
  expect(missingInstalled(['mnemo-desktop.exe', 'mnemo-desktop-ptyd.exe', 'uninstall.exe'])).toEqual(['mnemo-desktop-mcp.exe', 'mnemo-desktop-hook.exe'])
  // The names without `.exe` are another system's binaries, and the app's own must be there.
  expect(missingInstalled([APP_BIN, ...HELPERS])).toEqual([APP_BIN, ...HELPERS].map((n) => `${n}.exe`))
  expect(missingInstalled(HELPERS.map((h) => `${h}.exe`))).toEqual([`${APP_BIN}.exe`])
})

test('checkInstalled reads the folder itself and says what it lacks', () => {
  const full = folder(INSTALLED)
  const short = folder(['mnemo-desktop.exe', 'mnemo-desktop-mcp.exe', 'mnemo-desktop-ptyd.exe'])
  // A helper in a subfolder is not beside the app, which is where the app looks for it.
  mkdirSync(join(short, 'bin'))
  writeFileSync(join(short, 'bin', 'mnemo-desktop-hook.exe'), '')
  try {
    const lines = []
    expect(checkInstalled(full, (l) => lines.push(l))).toBe(true)
    expect(checkInstalled(short, (l) => lines.push(l))).toBe(false)
    expect(lines).toEqual([
      `${full}: mnemo-desktop-mcp.exe, mnemo-desktop-ptyd.exe, mnemo-desktop-hook.exe beside mnemo-desktop.exe`,
      `${short}: missing mnemo-desktop-hook.exe`,
    ])
  } finally {
    rmSync(full, { recursive: true, force: true })
    rmSync(short, { recursive: true, force: true })
  }
})

test('--installed exits 0 only for a folder with everything, as CI reads it', () => {
  const full = folder(INSTALLED)
  const short = folder(['mnemo-desktop.exe'])
  try {
    expect(run('--installed', full)).toEqual({ code: 0, out: expect.stringContaining('beside mnemo-desktop.exe') })
    const lacking = run('--installed', short)
    expect(lacking.code).toBe(1)
    expect(lacking.out).toContain('missing mnemo-desktop-mcp.exe, mnemo-desktop-ptyd.exe, mnemo-desktop-hook.exe')
    expect(run('--installed').code).toBe(2)
  } finally {
    rmSync(full, { recursive: true, force: true })
    rmSync(short, { recursive: true, force: true })
  }
})
