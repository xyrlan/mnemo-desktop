import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalTarget, idlePieces, lastWritten, pieceDir, pieceTargets, sizeOf, warnings } from './cargo-targets.mjs'

const HOUR = 3600 * 1000
let dir
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cargo-targets-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

/** Sets `path` and every dir above it up to `dir` to `at`. */
const touch = (path, at) => {
  for (let p = path; p.startsWith(dir) && p !== dir; p = resolve(p, '..')) utimesSync(p, at / 1000, at / 1000)
}

test('the canonical target is config.toml target-dir, resolved against the dir holding .cargo', () => {
  mkdirSync(join(dir, 'repo', '.cargo'), { recursive: true })
  writeFileSync(join(dir, 'repo', '.cargo', 'config.toml'), '# shared\n[build]\ntarget-dir = "../.mnemo-desktop-target"\n')
  expect(canonicalTarget(join(dir, 'repo'))).toBe(join(dir, '.mnemo-desktop-target'))
  expect(canonicalTarget(join(dir, 'missing'))).toBeNull()
})

test('the repo config names one target outside the checkout', () => {
  // vite rewrites a literal new URL(…, import.meta.url), so the root goes through a variable
  const here = import.meta.url
  // fileURLToPath, not .pathname: on Windows that is /D:/a/…, which resolve turns into D:\D:\a\…
  const root = resolve(fileURLToPath(new URL('.', here)), '..')
  expect(canonicalTarget(root)).toBe(resolve(root, '..', '.mnemo-desktop-target'))
})

test('piece targets are the mnemo-desktop-<piece> dirs of the cache, nothing else', () => {
  mkdirSync(join(dir, 'mnemo-desktop-r20-tailer'))
  mkdirSync(join(dir, 'mnemo-desktop-r21-pane'))
  mkdirSync(join(dir, 'mnemo'))
  writeFileSync(join(dir, 'mnemo-desktop-note'), '')
  expect(pieceTargets(dir).map((p) => p.piece)).toEqual(['r20-tailer', 'r21-pane'])
  expect(pieceTargets(join(dir, 'missing'))).toEqual([])
})

test('a build deep in the tree counts as a write; deeper than 3 levels does not', () => {
  const old = Date.now() - 72 * HOUR
  const recent = Date.now() - HOUR
  const fp = join(dir, 'debug', '.fingerprint', 'tauri-abc')
  mkdirSync(fp, { recursive: true })
  mkdirSync(join(dir, 'debug', 'deps', 'a', 'b'), { recursive: true })
  touch(join(dir, 'debug', 'deps', 'a', 'b'), old)
  touch(fp, old)
  utimesSync(dir, old / 1000, old / 1000)
  expect(lastWritten(dir)).toBe(old)
  utimesSync(join(dir, 'debug', 'deps', 'a', 'b'), recent / 1000, recent / 1000)
  expect(lastWritten(dir)).toBe(old)
  utimesSync(fp, recent / 1000, recent / 1000)
  expect(lastWritten(dir)).toBe(recent)
  expect(lastWritten(join(dir, 'missing'))).toBeNull()
})

test('size counts every file below, at least its length', () => {
  mkdirSync(join(dir, 'debug', 'deps'), { recursive: true })
  writeFileSync(join(dir, 'debug', 'deps', 'libtauri-1.rlib'), Buffer.alloc(100_000))
  writeFileSync(join(dir, 'debug', 'deps', 'libtauri-2.rlib'), Buffer.alloc(100_000))
  expect(sizeOf(dir)).toBeGreaterThanOrEqual(200_000)
  expect(sizeOf(join(dir, 'missing'))).toBe(0)
})

test('a target over the limit and pieces idle since landing are reported; a fresh piece is not', () => {
  const now = Date.UTC(2026, 9, 7)
  const pieces = [
    { piece: 'r20-tailer', path: '/c/mnemo-desktop-r20-tailer', written: now - 4 * 24 * HOUR },
    { piece: 'r21-pane', path: '/c/mnemo-desktop-r21-pane', written: now - 30 * HOUR },
    { piece: 'r22-live', path: '/c/mnemo-desktop-r22-live', written: now - HOUR },
  ]
  expect(idlePieces(pieces, now).map((p) => p.piece)).toEqual(['r20-tailer', 'r21-pane'])
  expect(warnings({ canonical: { path: '/t', bytes: 31.6 * 1024 ** 3 }, pieces, now })).toEqual([
    'cargo target /t holds 31.6 GB (over 20.0 GB); run `pnpm targets trim`',
    '2 per-piece cargo targets in /c untouched since landing: r20-tailer (4 days), r21-pane (30 h); run `pnpm targets prune`',
  ])
  expect(warnings({ canonical: { path: '/t', bytes: 5 * 1024 ** 3 }, pieces: pieces.slice(2), now })).toEqual([])
  expect(warnings({ canonical: null, pieces: [], now })).toEqual([])
})

test('prune names a piece dir inside the cache, never a path out of it', () => {
  expect(pieceDir('/c', 'r21-pane')).toBe(join('/c', 'mnemo-desktop-r21-pane'))
  expect(pieceDir('/c', 'mnemo-desktop-r21-pane')).toBe(join('/c', 'mnemo-desktop-r21-pane'))
  for (const bad of ['', '..', '.', '../x', 'a/b', 'mnemo-desktop-', '$HOME']) expect(pieceDir('/c', bad)).toBeNull()
})
