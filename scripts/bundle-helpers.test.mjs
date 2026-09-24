import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { APP_BIN, HELPERS, builtBundles, check, kindOf, missingHelpers } from './bundle-helpers.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const TAURI = join(ROOT, 'src-tauri')

const fakeApp = (dir, bins) => {
  const app = join(dir, 'release/bundle/macos/mnemo.app')
  mkdirSync(join(app, 'Contents/MacOS'), { recursive: true })
  mkdirSync(join(app, 'Contents/Resources'), { recursive: true })
  for (const b of bins) writeFileSync(join(app, 'Contents/MacOS', b), '')
  return app
}

test('every binary in src-tauri/src/bin is a helper the bundle must carry', () => {
  const bins = readdirSync(join(TAURI, 'src/bin')).map((f) => f.replace(/\.rs$/, ''))
  expect([...bins].sort()).toEqual([...HELPERS].sort())
})

test('Cargo.toml declares every helper, which is what puts it in the bundle', () => {
  const toml = readFileSync(join(TAURI, 'Cargo.toml'), 'utf8')
  const declared = [...toml.matchAll(/\[\[bin\]\]\s*\nname = "([^"]+)"\s*\npath = "([^"]+)"/g)].map((m) => [m[1], m[2]])
  const byName = (a, b) => a[0].localeCompare(b[0])
  expect(declared.sort(byName)).toEqual(HELPERS.map((h) => [h, `src/bin/${h}.rs`]).sort(byName))
})

test('a bundle kind comes from its name', () => {
  expect(kindOf('/x/bundle/macos/mnemo.app')).toBe('app')
  expect(kindOf('mnemo_0.2.0_amd64.deb')).toBe('deb')
  expect(kindOf('mnemo_0.2.0_amd64.AppImage')).toBe('appimage')
  expect(kindOf('mnemo_0.2.0_aarch64.dmg')).toBeNull()
})

test('a macOS bundle needs the helpers in Contents/MacOS, beside the app', () => {
  const all = [APP_BIN, ...HELPERS].map((b) => `Contents/MacOS/${b}`)
  expect(missingHelpers('app', ['Contents', 'Contents/MacOS', ...all, 'Contents/Info.plist'])).toEqual([])
  // What `tauri build` shipped before the helpers were declared.
  expect(missingHelpers('app', ['Contents/MacOS/mnemo-desktop', 'Contents/MacOS/mnemo-desktop-ptyd'])).toEqual([
    'mnemo-desktop-mcp',
    'mnemo-desktop-hook',
  ])
  // A helper somewhere else in the bundle is not beside the app, which is where it is looked for.
  expect(missingHelpers('app', ['Contents/MacOS/mnemo-desktop', ...HELPERS.map((h) => `Contents/Resources/${h}`)])).toEqual(HELPERS)
})

test('a helper beside no app does not pass', () => {
  expect(missingHelpers('app', HELPERS.map((h) => `Contents/MacOS/${h}`))).toEqual([APP_BIN])
})

test('a deb listing reads with or without the leading ./', () => {
  const all = [APP_BIN, ...HELPERS]
  expect(missingHelpers('deb', ['./', './usr/', './usr/bin/', ...all.map((b) => `./usr/bin/${b}`)])).toEqual([])
  expect(missingHelpers('appimage', all.map((b) => `usr/bin/${b}`))).toEqual([])
  expect(missingHelpers('deb', ['./usr/bin/mnemo-desktop'])).toEqual(HELPERS)
})

test('check reads a real bundle directory and says what it lacks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bundle-helpers-'))
  try {
    const full = fakeApp(join(dir, 'full'), [APP_BIN, ...HELPERS])
    const lines = []
    expect(check([full], (l) => lines.push(l))).toBe(true)
    expect(lines).toEqual([`${full}: ${HELPERS.join(', ')} beside ${APP_BIN}`])

    const short = fakeApp(join(dir, 'short'), [APP_BIN, 'mnemo-desktop-ptyd'])
    lines.length = 0
    expect(check([full, short], (l) => lines.push(l))).toBe(false)
    expect(lines[1]).toBe(`${short}: missing mnemo-desktop-mcp, mnemo-desktop-hook in Contents/MacOS/`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the bundles tauri left are found under release/bundle', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bundle-helpers-'))
  try {
    const app = fakeApp(dir, [])
    mkdirSync(join(dir, 'release/bundle/deb'), { recursive: true })
    writeFileSync(join(dir, 'release/bundle/deb/mnemo_0.2.0_amd64.deb'), '')
    mkdirSync(join(dir, 'release/bundle/dmg'), { recursive: true })
    writeFileSync(join(dir, 'release/bundle/dmg/mnemo_0.2.0_aarch64.dmg'), '')
    expect(builtBundles(dir)).toEqual([app, join(dir, 'release/bundle/deb/mnemo_0.2.0_amd64.deb')])
    expect(builtBundles(join(dir, 'nothing'))).toEqual([])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
