#!/usr/bin/env node
/**
 * The Cargo target dirs this repo leaves on disk (#291). See cargo-targets.mjs for which is which.
 *
 *   pnpm targets                 sizes of the canonical target and every per-piece target
 *   pnpm targets check           warn when one needs removing; quick (`pnpm test` runs it first)
 *   pnpm targets prune <piece>…  remove those per-piece targets (at landing, one per landed piece)
 *   pnpm targets prune           remove every per-piece target untouched for 24 h
 *   pnpm targets trim            remove the canonical target when it is over 20 GB
 *
 * prune and trim skip a dir written in the last 10 minutes: a build may be running in it.
 */
import { rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BUSY_MS,
  LIMIT_BYTES,
  canonicalTarget,
  gb,
  idlePieces,
  lastWritten,
  pieceDir,
  pieceTargets,
  sizeOf,
  warnings,
} from './cargo-targets.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const CACHE = join(homedir(), '.cache')
const now = Date.now()
const [cmd = 'list', ...args] = process.argv.slice(2)

const pieces = () => pieceTargets(CACHE).map((p) => ({ ...p, written: lastWritten(p.path) }))
const busy = (path) => {
  const t = lastWritten(path)
  return t !== null && now - t < BUSY_MS
}
const remove = (path) => {
  if (busy(path)) {
    console.log(`skipped ${path}: written in the last ${BUSY_MS / 60000} minutes`)
    return
  }
  const bytes = sizeOf(path)
  rmSync(path, { recursive: true, force: true })
  console.log(`removed ${path} (${gb(bytes)})`)
}

if (cmd === 'check') {
  // Never fails the suite: a report that cannot be made is not a test failure.
  try {
    const path = canonicalTarget(ROOT)
    const canonical = path ? { path, bytes: sizeOf(path) } : null
    for (const line of warnings({ canonical, pieces: pieces(), now })) console.warn(`warning: ${line}`)
  } catch (e) {
    console.warn(`warning: could not size the cargo targets: ${e.message}`)
  }
} else if (cmd === 'list') {
  const path = canonicalTarget(ROOT)
  if (path) console.log(`${gb(sizeOf(path)).padStart(9)}  ${path}  (canonical, kept; trimmed past ${gb(LIMIT_BYTES)})`)
  for (const p of pieces()) console.log(`${gb(sizeOf(p.path)).padStart(9)}  ${p.path}  (per-piece, remove at landing)`)
} else if (cmd === 'prune') {
  const targets = args.length
    ? args.map((name) => {
        const path = pieceDir(CACHE, name)
        if (!path) {
          console.error(`not a piece name: ${name}`)
          process.exit(1)
        }
        return path
      })
    : idlePieces(pieces(), now).map((p) => p.path)
  if (!targets.length) console.log('no per-piece cargo targets to remove')
  for (const path of targets) {
    if (lastWritten(path) === null) console.log(`no ${path}`)
    else remove(path)
  }
} else if (cmd === 'trim') {
  const path = canonicalTarget(ROOT)
  const bytes = path ? sizeOf(path) : 0
  if (!path) console.log('no target-dir in .cargo/config.toml')
  else if (bytes <= LIMIT_BYTES) console.log(`${path} holds ${gb(bytes)}, under ${gb(LIMIT_BYTES)}; kept`)
  else remove(path) // the next build is a cold one; Cargo has no way to drop only stale artifacts
} else {
  console.error(`unknown command: ${cmd} (list, check, prune, trim)`)
  process.exit(1)
}
