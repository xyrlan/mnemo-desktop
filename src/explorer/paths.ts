// adapted from stablyai/orca components/right-sidebar/file-explorer-entries.ts and file-explorer-paths.ts

export const joinPath = (dir: string, name: string) => (dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`)

export function dirname(path: string): string {
  const i = path.lastIndexOf('/')
  return i <= 0 ? '/' : path.slice(0, i)
}

export const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1)

/** `path` from `root`, or null when it is not inside it. */
export function relativeTo(root: string, path: string): string | null {
  const base = root.endsWith('/') ? root : `${root}/`
  return path.startsWith(base) ? path.slice(base.length) : null
}

/** The folders between `root` (left out) and `path` (left out), outermost first. */
export function ancestorsOf(root: string, path: string): string[] {
  const rel = relativeTo(root, path)
  if (rel === null) return []
  const parts = rel.split('/')
  const out: string[] = []
  let at = root
  for (const part of parts.slice(0, -1)) {
    at = joinPath(at, part)
    out.push(at)
  }
  return out
}

/** `.git` and `node_modules` never show, whatever the toggles say. */
export const shouldIncludeEntry = (name: string) => name !== '.git' && name !== 'node_modules'

const isDotfileSegment = (segment: string) => segment.length > 1 && segment !== '..' && segment.startsWith('.')

export const isDotfileRelativePath = (relativePath: string) => relativePath.split('/').some(isDotfileSegment)

/** Git names an ignored folder once (`dist/`), not each file in it: a path is ignored when it or
 *  a folder above it is in the set. */
export function isPathIgnored(ignored: ReadonlySet<string>, relativePath: string): boolean {
  if (ignored.size === 0) return false
  let at = relativePath
  for (;;) {
    if (ignored.has(at)) return true
    const i = at.lastIndexOf('/')
    if (i < 0) return false
    at = at.slice(0, i)
  }
}
