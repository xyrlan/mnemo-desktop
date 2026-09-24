#!/usr/bin/env node
/**
 * Builds mnemo and puts it in /Applications, so the app you open is the commit you merged (#88).
 *
 *   pnpm run install-app            build, quit the running app, swap the bundle, relaunch
 *   pnpm run install-app:check      print a reminder when the installed bundle is behind main
 *
 * The swap runs from a detached /bin/sh, not from here, because the terminal you typed this in
 * is very often a pane of the app we are about to quit. Since the terminal daemon (#209) a
 * pane's shell outlives the app on macOS and Linux, but the running app may predate it, and a
 * script killed between the delete and the copy leaves no app at all. The new bundle is staged beside the old one first, so the only thing that happens while
 * the app is down is two renames.
 */
import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BIN_DIR, listBundle, missingHelpers } from './bundle-helpers.mjs'
import { shaOfVersionLine, staleReminder } from './stale.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const APP = '/Applications/mnemo.app'
const NEW = `${APP}.new`
const OLD = `${APP}.old`
const EXE = 'Contents/MacOS/mnemo-desktop'
const STAMP = 'Contents/Resources/mnemo-build.json'

/** Captured stdout, trimmed. */
const out = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', ...opts }).trim()
/** Straight to the terminal: builds and copies that take a while have their own output. */
const loud = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit', ...opts })
/** Captured stdout, or null when the command is missing or fails — asking is allowed to fail. */
const ask = (cmd, args, opts = {}) => {
  try {
    return out(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'], ...opts })
  } catch {
    return null
  }
}
const die = (msg) => {
  console.error(msg)
  process.exit(1)
}

/** `main`, else `origin/main` — whichever this checkout has. */
const mainRef = () => ['main', 'origin/main'].find((r) => ask('git', ['rev-parse', '--verify', '--quiet', `${r}^{commit}`]))

/** What the installed bundle is: the sha it was stamped with, and when it landed. */
function installed() {
  if (!existsSync(APP)) return null
  let sha = null
  try {
    sha = JSON.parse(readFileSync(join(APP, STAMP), 'utf8')).sha || null
  } catch {
    // A bundle installed before this script existed carries no stamp; its mtime is all we get.
  }
  return { at: statSync(APP).mtime, sha }
}

/** The reminder for a merge routine: one line when the app is behind, nothing otherwise. */
function check() {
  const ref = mainRef()
  const app = installed()
  if (!ref || !app) return
  const at = Number(ask('git', ['log', '-1', '--format=%ct', ref]))
  if (!at) return
  // `behind` stays null when git never heard of that sha — a bundle from another checkout, or
  // one built before the stamp existed. staleReminder then falls back to the bundle's mtime.
  const known = app.sha && ask('git', ['cat-file', '-e', `${app.sha}^{commit}`]) !== null
  const count = known ? Number(ask('git', ['rev-list', '--count', `${app.sha}..${ref}`])) : NaN
  const line = staleReminder({ at: app.at, behind: Number.isNaN(count) ? null : count }, new Date(at * 1000))
  if (line) console.log(line)
}

function install({ launch }) {
  const sha = ask('git', ['rev-parse', '--short=7', 'HEAD']) || ''
  console.log(`building ${sha || 'HEAD'}…`)
  // Pinning the sha here rather than leaving build.rs to guess is also what makes cargo
  // re-run build.rs when the commit moved: it watches MNEMO_BUILD_SHA (see src-tauri/build.rs).
  loud('pnpm', ['tauri', 'build', '--bundles', 'app'], { env: { ...process.env, MNEMO_BUILD_SHA: sha } })

  const meta = JSON.parse(out('cargo', ['metadata', '--no-deps', '--format-version', '1', '--manifest-path', 'src-tauri/Cargo.toml']))
  const built = join(meta.target_directory, 'release/bundle/macos/mnemo.app')
  if (!existsSync(built)) die(`tauri build left no bundle at ${built}`)
  // The MCP bridge, the terminal daemon and the agent-status hook are looked for beside the app's
  // executable: a bundle without them installs an app with those quietly off.
  const missing = missingHelpers('app', listBundle(built))
  if (missing.length) die(`the bundle has no ${missing.join(', ')} in ${BIN_DIR.app}: refusing to install it (see src-tauri/Cargo.toml's [[bin]])`)

  // Ask the binary itself, which is the only answer that proves the stamp survived the build.
  const version = ask(join(built, EXE), ['--version'], { timeout: 20_000 })
  if (version && sha && shaOfVersionLine(version) !== sha) {
    die(`the build reports "${version}" but we asked for ${sha}: refusing to install a bundle that misstates its commit`)
  }
  // The same sha again, as a file, so `--check` can read it without launching anything.
  writeFileSync(join(built, STAMP), `${JSON.stringify({ sha, version, installed_at: new Date().toISOString() }, null, 2)}\n`)

  rmSync(NEW, { recursive: true, force: true })
  loud('ditto', [built, NEW])

  const dir = mkdtempSync(join(tmpdir(), 'mnemo-install-'))
  const swap = join(dir, 'swap.sh')
  writeFileSync(swap, SWAP.replace('@LAUNCH@', launch ? 'yes' : 'no'))
  chmodSync(swap, 0o755)

  console.log(version || `built ${sha}`)
  if (process.env.TERM_PROGRAM === 'mnemo') {
    console.log('quitting mnemo and swapping the bundle in: the app comes back')
    spawn('/bin/sh', [swap], { detached: true, stdio: 'ignore' }).unref()
  } else {
    loud('/bin/sh', [swap])
    rmSync(dir, { recursive: true, force: true })
    console.log(`installed at ${APP}`)
  }
}

const SWAP = `#!/bin/sh
# Written and launched by scripts/install-app.mjs; see the note at the top of it.
set -e
APP=${APP}
NEW=${NEW}
OLD=${OLD}
running() { pgrep -f "^$APP/${EXE}" >/dev/null 2>&1; }
if running; then
  osascript -e 'tell application id "sh.mnemo.desktop" to quit' >/dev/null 2>&1 || true
  n=0
  while running && [ $n -lt 100 ]; do sleep 0.1; n=$((n+1)); done
  if running; then pkill -f "^$APP/${EXE}" >/dev/null 2>&1 || true; sleep 0.5; fi
fi
rm -rf "$OLD"
if [ -e "$APP" ]; then mv "$APP" "$OLD"; fi
mv "$NEW" "$APP"
rm -rf "$OLD"
if [ "@LAUNCH@" = yes ]; then open "$APP"; fi
here=$(dirname "$0")
rm -f "$0"
rmdir "$here" 2>/dev/null || true
`

const args = process.argv.slice(2)
if (args.includes('--check')) {
  if (process.platform === 'darwin') check()
} else if (process.platform !== 'darwin') {
  die('install-app copies into /Applications: macOS only. Elsewhere `pnpm tauri build` makes the bundle.')
} else {
  install({ launch: !args.includes('--no-launch') })
}
