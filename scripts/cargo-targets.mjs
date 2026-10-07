/** Which Cargo target dirs this repo leaves on disk, and which may go (#291).
 *
 * Two kinds live outside the checkout:
 * - the canonical target, `.cargo/config.toml`'s `target-dir`, shared by every worktree and kept;
 * - per-piece targets `~/.cache/mnemo-desktop-<piece>`, which a dispatched child builds into so
 *   parallel builds stay off Cargo's lock. They are temporary: landing removes them.
 * Cargo never deletes a stale artifact, so the canonical one only grows (one machine held 4
 * libtauri builds and 125 incremental sessions in it) and needs a size bound.
 *
 * Everything here takes paths and a clock, so it is tested against temp dirs. */
import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export const PIECE_PREFIX = 'mnemo-desktop-'
/** The canonical target is reported, then trimmed, past this. */
export const LIMIT_BYTES = 20 * 1024 ** 3
/** A piece dir untouched this long belongs to a piece that has landed or was dropped. */
export const IDLE_MS = 24 * 3600 * 1000
/** Trim and prune leave alone a dir written this recently: a build may be running in it. */
export const BUSY_MS = 10 * 60 * 1000

/** `target-dir` from `<root>/.cargo/config.toml`, resolved the way Cargo does: against the
 *  directory holding `.cargo`. Null when the file or the key is missing. */
export function canonicalTarget(root) {
  let text
  try {
    text = readFileSync(join(root, '.cargo', 'config.toml'), 'utf8')
  } catch {
    return null
  }
  const m = /^\s*target-dir\s*=\s*"([^"]+)"/m.exec(text)
  return m ? resolve(root, m[1]) : null
}

/** `~/.cache/mnemo-desktop-*` directories, as `{ piece, path }`. */
export function pieceTargets(cacheDir) {
  let names
  try {
    names = readdirSync(cacheDir, { withFileTypes: true })
  } catch {
    return []
  }
  return names
    .filter((d) => d.isDirectory() && d.name.startsWith(PIECE_PREFIX) && d.name.length > PIECE_PREFIX.length)
    .map((d) => ({ piece: d.name.slice(PIECE_PREFIX.length), path: join(cacheDir, d.name) }))
    .sort((a, b) => a.piece.localeCompare(b.piece))
}

/** The newest mtime of `dir` and what lies within `depth` levels of it, in ms; null when `dir`
 *  is missing. A build touches `debug/.fingerprint`, `debug/deps` and `debug/build` (all within
 *  2), so this sees one without walking the whole tree. */
export function lastWritten(dir, depth = 3) {
  let st
  try {
    st = lstatSync(dir)
  } catch {
    return null
  }
  let newest = st.mtimeMs
  if (depth > 0 && st.isDirectory()) {
    let names = []
    try {
      names = readdirSync(dir)
    } catch {}
    for (const name of names) {
      const t = lastWritten(join(dir, name), depth - 1)
      if (t !== null && t > newest) newest = t
    }
  }
  return newest
}

/** Bytes on disk under `path` (blocks where the platform has them), symlinks not followed. */
export function sizeOf(path) {
  let st
  try {
    st = lstatSync(path)
  } catch {
    return 0
  }
  let bytes = st.blocks != null ? st.blocks * 512 : st.size
  if (st.isDirectory()) {
    let names = []
    try {
      names = readdirSync(path)
    } catch {}
    for (const name of names) bytes += sizeOf(join(path, name))
  }
  return bytes
}

export function gb(bytes) {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

function age(ms) {
  const h = ms / 3600000
  return h < 48 ? `${Math.floor(h)} h` : `${Math.floor(h / 24)} days`
}

/** The piece dirs `prune` with no names removes: idle at least `idleMs`. */
export function idlePieces(pieces, now, idleMs = IDLE_MS) {
  return pieces.filter((p) => p.written !== null && now - p.written >= idleMs)
}

/** What `pnpm test` prints before the suite: nothing when all is well.
 *  @param canonical  `{ path, bytes }` or null
 *  @param pieces     `{ piece, path, written }` */
export function warnings({ canonical, pieces, now, limit = LIMIT_BYTES, idleMs = IDLE_MS }) {
  const lines = []
  if (canonical && canonical.bytes > limit) {
    lines.push(`cargo target ${canonical.path} holds ${gb(canonical.bytes)} (over ${gb(limit)}); run \`pnpm targets trim\``)
  }
  const idle = idlePieces(pieces, now, idleMs)
  if (idle.length) {
    const names = idle.map((p) => `${p.piece} (${age(now - p.written)})`).join(', ')
    lines.push(`${idle.length} per-piece cargo target${idle.length === 1 ? '' : 's'} in ${dirname(idle[0].path)} untouched since landing: ${names}; run \`pnpm targets prune\``)
  }
  return lines
}

/** The dir `prune <name>` may remove: a bare piece name, or the whole `mnemo-desktop-<piece>`.
 *  Null for anything that could step out of the cache dir. */
export function pieceDir(cacheDir, name) {
  const piece = name.startsWith(PIECE_PREFIX) ? name.slice(PIECE_PREFIX.length) : name
  if (!piece || !/^[A-Za-z0-9._-]+$/.test(piece) || piece === '.' || piece === '..') return null
  return join(cacheDir, PIECE_PREFIX + piece)
}
