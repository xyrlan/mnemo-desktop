/** The front end's one way to compare and name paths (#355).
 *
 *  On Windows one folder reaches the front end spelt three ways: `C:/Users/you/repo` from git,
 *  `C:\Users\you\repo` from the OS (a folder picker, Claude Code), `\\?\C:\Users\you\repo` from
 *  `canonicalize`. `norm` gives all three one spelling — git's, with the drive letter in capitals
 *  — and every comparison and every basename goes through it.
 *
 *  Only a path that is Windows-shaped (a drive letter, `\\?\`, a `\\server\share`) is rewritten.
 *  A POSIX path, where `\` is a character a name may hold, only loses a trailing `/`: on macOS and
 *  Linux every answer is what it was before. */

const VERBATIM_UNC = /^\\\\\?\\UNC\\/i
const VERBATIM = /^\\\\\?\\/
const DRIVE = /^[A-Za-z]:(?:[\\/]|$)/
const UNC = /^\\\\[^\\/?]/

/** A path Windows would read: `C:\…`, `c:/…`, `C:`, `\\?\C:\…`, `\\server\share\…`. */
export function isWindowsPath(p: string): boolean {
  return DRIVE.test(p) || VERBATIM.test(p) || UNC.test(p)
}

/** A path that names its folder whatever the cwd: `/…`, or a Windows one above. */
export function isAbsolute(p: string): boolean {
  return p.startsWith('/') || isWindowsPath(p)
}

/** `p` in the one spelling paths are compared in: no trailing separator (but a root keeps its
 *  own: `/`, `C:/`), and on Windows forward slashes, a capital drive letter, no `\\?\`. */
export function norm(p: string): string {
  if (!isWindowsPath(p)) return p.length > 1 ? p.replace(/\/+$/, '') : p
  let s = p.replace(VERBATIM_UNC, '\\\\').replace(VERBATIM, '').replace(/\\/g, '/')
  if (/^[a-z]:/.test(s)) s = s[0].toUpperCase() + s.slice(1)
  const trimmed = s.replace(/\/+$/, '')
  return /^[A-Z]:$/.test(trimmed) ? `${trimmed}/` : trimmed
}

/** The same folder, whichever spelling each came in. */
export const samePath = (a: string, b: string) => norm(a) === norm(b)

/** `path` is `dir` or somewhere under it; `/a/bc` is not under `/a/b`. */
export function within(path: string, dir: string): boolean {
  const p = norm(path)
  const d = norm(dir)
  return p === d || p.startsWith(d.endsWith('/') ? d : `${d}/`)
}

/** The last name in `p` (`repo` of `C:\Users\you\repo\`); a root is its own name. */
export function basename(p: string): string {
  const n = norm(p)
  return n.slice(n.lastIndexOf('/') + 1) || n || p
}

/** The folder `p` is in; a root is its own. */
export function dirname(p: string): string {
  const n = norm(p)
  const i = n.lastIndexOf('/')
  if (i < 0) return '.'
  const head = n.slice(0, i)
  if (head === '') return '/'
  if (/^[A-Z]:$/.test(head)) return `${head}/`
  return head
}

/** `path` from inside `dir`, in `path`'s own spelling (`src\app.ts` stays so); `null` when it is
 *  not under `dir`, `''` when it is `dir`. */
export function relativeTo(path: string, dir: string): string | null {
  if (!within(path, dir)) return null
  const p = norm(path)
  const d = norm(dir)
  if (p === d) return ''
  const rest = p.length - (d.endsWith('/') ? d.length : d.length + 1)
  // `norm` changes no length after the prefix it drops: the tail of the original is the same names.
  const own = isWindowsPath(path) ? path.replace(/[\\/]+$/, '') : path.replace(/\/+$/, '')
  return own.slice(own.length - rest)
}
