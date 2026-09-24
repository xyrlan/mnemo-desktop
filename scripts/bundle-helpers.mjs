#!/usr/bin/env node
/**
 * Does a release bundle carry the app's helper binaries? The app finds each one beside its own
 * executable (`current_exe().with_file_name(…)` in mcp.rs, agent_hooks.rs and pty.rs), so a
 * bundle without them installs an app whose MCP bridge, agent status and surviving terminals
 * quietly do nothing.
 *
 *   node scripts/bundle-helpers.mjs [<bundle>…]    check these, or every bundle `tauri build` left
 *
 * Used by `pnpm run install-app` before it installs, and by CI after it bundles.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const APP_BIN = 'mnemo-desktop'
/** The MCP bridge, the terminal daemon, the agent-status hook. */
export const HELPERS = ['mnemo-desktop-mcp', 'mnemo-desktop-ptyd', 'mnemo-desktop-hook']

/** Where each kind of bundle keeps the app's executable, and so the helpers beside it. */
export const BIN_DIR = { app: 'Contents/MacOS', deb: 'usr/bin', appimage: 'usr/bin' }

/** `app`, `deb` or `appimage` from a bundle's file name; null for a kind we do not check. */
export function kindOf(path) {
  const name = basename(path).toLowerCase()
  if (name.endsWith('.app')) return 'app'
  if (name.endsWith('.deb')) return 'deb'
  if (name.endsWith('.appimage')) return 'appimage'
  return null
}

/**
 * What of the app and its helpers the bundle lacks: every name not found in `BIN_DIR[kind]`.
 * The app's own binary is required too, so a helper can only pass by being beside it.
 * @param files  paths inside the bundle, relative to its root (a leading `./` is ignored).
 */
export function missingHelpers(kind, files) {
  const dir = BIN_DIR[kind]
  const have = new Set(files.map((f) => f.replace(/^\.\//, '').replace(/\/+$/, '')))
  return [APP_BIN, ...HELPERS].filter((name) => !have.has(`${dir}/${name}`))
}

/** The files in a bundle, as paths relative to its root. */
export function listBundle(path) {
  const kind = kindOf(path)
  if (kind === 'app') {
    return readdirSync(path, { recursive: true }).map(String)
  }
  if (kind === 'deb') {
    // `dpkg-deb -c` prints `ls -l`-style lines ending in the path, `./usr/bin/…`.
    return execFileSync('dpkg-deb', ['-c', path], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split(/\s+/).slice(5).join(' ').replace(/ -> .*$/, ''))
  }
  if (kind === 'appimage') {
    // `--appimage-extract` needs no FUSE; it unpacks into ./squashfs-root of its cwd.
    const dir = mkdtempSync(join(tmpdir(), 'mnemo-appimage-'))
    try {
      execFileSync(path, ['--appimage-extract'], { cwd: dir, stdio: 'ignore' })
      return readdirSync(join(dir, 'squashfs-root'), { recursive: true }).map(String)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
  throw new Error(`${path}: not a bundle this checks (.app, .deb, .AppImage)`)
}

/** Every checkable bundle under `<target>/release/bundle`. */
export function builtBundles(targetDir) {
  const root = join(targetDir, 'release/bundle')
  const out = []
  for (const sub of ['macos', 'deb', 'appimage']) {
    const dir = join(root, sub)
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir)) if (kindOf(name)) out.push(join(dir, name))
  }
  return out
}

/** One line per bundle; true when every bundle has everything. */
export function check(bundles, log = console.log) {
  let ok = true
  for (const b of bundles) {
    const missing = missingHelpers(kindOf(b), listBundle(b))
    if (missing.length) {
      ok = false
      log(`${b}: missing ${missing.join(', ')} in ${BIN_DIR[kindOf(b)]}/`)
    } else {
      log(`${b}: ${HELPERS.join(', ')} beside ${APP_BIN}`)
    }
  }
  return ok
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = dirname(dirname(fileURLToPath(import.meta.url)))
  let bundles = process.argv.slice(2)
  if (!bundles.length) {
    const meta = JSON.parse(
      execFileSync('cargo', ['metadata', '--no-deps', '--format-version', '1', '--manifest-path', 'src-tauri/Cargo.toml'], {
        cwd: root,
        encoding: 'utf8',
      }),
    )
    bundles = builtBundles(meta.target_directory)
  }
  if (!bundles.length) {
    console.error('no bundle to check: run `pnpm tauri build` first')
    process.exit(1)
  }
  if (!check(bundles)) process.exit(1)
}
