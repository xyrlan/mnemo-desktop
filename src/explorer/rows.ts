// adapted from stablyai/orca components/right-sidebar/file-explorer-row-projection.ts and file-explorer-name-filter-projection.ts
import type { DirEntry, TreeNode } from './types'
import { isDotfileRelativePath, isPathIgnored, joinPath, shouldIncludeEntry } from './paths'

export type RowProjection = {
  getVisibleCount: () => number
  getRowAtIndex: (index: number) => TreeNode | null
  getRowByPath: (path: string) => TreeNode | null
  getIndexByPath: (path: string) => number | null
  getParentIndex: (index: number) => number | null
  getFirstChildIndex: (index: number) => number | null
}

export function createRowProjection(rows: readonly TreeNode[]): RowProjection {
  const rowsByPath = new Map<string, TreeNode>()
  for (const row of rows) rowsByPath.set(row.path, row)
  let indexByPath: Map<string, number> | null = null
  // Why: rendering needs path lookup only; the index is built when navigation first asks.
  const getIndexByPathMap = () => {
    if (indexByPath) return indexByPath
    indexByPath = new Map(rows.map((r, i) => [r.path, i]))
    return indexByPath
  }
  return {
    getVisibleCount: () => rows.length,
    getRowAtIndex: (index) => rows[index] ?? null,
    getRowByPath: (path) => rowsByPath.get(path) ?? null,
    getIndexByPath: (path) => getIndexByPathMap().get(path) ?? null,
    getParentIndex: (index) => {
      const current = rows[index]
      if (!current || current.depth <= 0) return null
      for (let i = index - 1; i >= 0; i -= 1) if (rows[i].depth < current.depth) return i
      return null
    },
    getFirstChildIndex: (index) => {
      const current = rows[index]
      if (!current?.isDirectory) return null
      return rows[index + 1]?.depth === current.depth + 1 ? index + 1 : null
    },
  }
}

export type Visibility = {
  showDotfiles: boolean
  showIgnored: boolean
  /** Relative paths git ignores; a folder stands for everything in it. */
  ignored: ReadonlySet<string>
}

const visible = (relativePath: string, v: Visibility) =>
  (v.showDotfiles || !isDotfileRelativePath(relativePath)) && (v.showIgnored || !isPathIgnored(v.ignored, relativePath))

/** The tree as rows: `root`'s listing, and inside each expanded folder its own, as far as the
 *  listings have been read. A folder expanded but not read yet shows as a closed row. */
export function flattenTree(
  root: string,
  dirs: Readonly<Record<string, readonly DirEntry[]>>,
  expanded: ReadonlySet<string>,
  v: Visibility,
): TreeNode[] {
  const out: TreeNode[] = []
  const walk = (dir: string, rel: string, depth: number) => {
    for (const e of dirs[dir] ?? []) {
      if (!shouldIncludeEntry(e.name)) continue
      const relativePath = rel ? `${rel}/${e.name}` : e.name
      if (!visible(relativePath, v)) continue
      const path = joinPath(dir, e.name)
      out.push({ name: e.name, path, relativePath, isDirectory: e.isDirectory, depth })
      if (e.isDirectory && expanded.has(path)) walk(path, relativePath, depth + 1)
    }
  }
  walk(root, '', 0)
  return out
}

/** Longer queries match nothing rather than cost a scan per keystroke. */
export const NAME_FILTER_QUERY_MAX_BYTES = 1024

/** The query's words, lowercased; a path matches when it holds every one. */
export function nameFilterTokens(query: string): string[] {
  if (new TextEncoder().encode(query).length > NAME_FILTER_QUERY_MAX_BYTES) return []
  return query.toLowerCase().split(/\s+/).filter(Boolean)
}

export const pathMatchesTokens = (relativePath: string, tokens: readonly string[]) => {
  const p = relativePath.toLowerCase()
  return tokens.every((t) => p.includes(t))
}

type Synthetic = { node: TreeNode; children: Map<string, Synthetic> }

/** Collation of `fs_list`: folders first, then case-insensitively by name. */
function compareEntries(a: TreeNode, b: TreeNode): number {
  if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
  const x = a.name.toLowerCase()
  const y = b.name.toLowerCase()
  return x < y ? -1 : x > y ? 1 : 0
}

/** The files whose path matches `query`, drawn as a tree of just them and the folders above
 *  them, every folder open unless the user closed it (`collapsed`). */
export function filteredRows(root: string, files: readonly string[], query: string, v: Visibility, collapsed: ReadonlySet<string>): TreeNode[] {
  const tokens = nameFilterTokens(query)
  if (tokens.length === 0) return []
  const top = new Map<string, Synthetic>()
  for (const relativePath of files) {
    if (!relativePath || relativePath.split('/').some((s) => !shouldIncludeEntry(s))) continue
    if (!visible(relativePath, v) || !pathMatchesTokens(relativePath, tokens)) continue
    const segments = relativePath.split('/')
    let level = top
    let rel = ''
    segments.forEach((name, depth) => {
      rel = rel ? `${rel}/${name}` : name
      const isDirectory = depth < segments.length - 1
      let entry = level.get(name)
      if (!entry) {
        entry = { node: { name, path: joinPath(root, rel), relativePath: rel, isDirectory, depth }, children: new Map() }
        level.set(name, entry)
      } else if (isDirectory && !entry.node.isDirectory) {
        entry.node = { ...entry.node, isDirectory: true }
      }
      level = entry.children
    })
  }
  const out: TreeNode[] = []
  const append = (entries: Iterable<Synthetic>) => {
    for (const e of [...entries].sort((a, b) => compareEntries(a.node, b.node))) {
      out.push(e.node)
      if (e.children.size > 0 && !collapsed.has(e.node.path)) append(e.children.values())
    }
  }
  append(top.values())
  return out
}

/** The folders drawn open in a filtered tree: those whose next row is inside them. */
export function openFolders(rows: readonly TreeNode[]): Set<string> {
  const out = new Set<string>()
  for (let i = 0; i < rows.length - 1; i += 1) if (rows[i].isDirectory && rows[i + 1].depth > rows[i].depth) out.add(rows[i].path)
  return out
}
