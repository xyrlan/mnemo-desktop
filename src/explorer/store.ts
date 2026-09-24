import { createStore, type StoreApi } from 'zustand/vanilla'
import type { ExplorerClient } from './client'
import { fileStatuses, folderStatuses, parseIgnored } from './git'
import { ancestorsOf } from './paths'
import type { DirEntry, GitFileStatus } from './types'

/** What the user chose for one worktree; it outlives switching away and back. */
export type RootPrefs = {
  /** Absolute paths of the open folders. */
  expanded: string[]
  showDotfiles: boolean
  showIgnored: boolean
}

export type GitView = {
  files: ReadonlyMap<string, GitFileStatus>
  folders: ReadonlyMap<string, GitFileStatus>
  ignored: ReadonlySet<string>
}

/** The name filter's list of every file; `paths` null while it is read. */
export type FileList = { paths: string[] | null; error: string | null }

export type ExplorerState = {
  prefs: Record<string, RootPrefs>
  /** Listings by absolute folder path; worktrees never share one, so one map serves them all. */
  dirs: Record<string, DirEntry[]>
  /** Folders read for the first time: a folder already drawn refreshes without a spinner. */
  loading: Record<string, true>
  errors: Record<string, string>
  git: Record<string, GitView>
  files: Record<string, FileList>
}

export type ExplorerActions = {
  /** Shows `root`: reads it, its open folders and its git state. */
  open(root: string): Promise<void>
  /** Reads again what `open` read, and the file list when the name filter has one. */
  refresh(root: string): Promise<void>
  toggle(root: string, dir: string): void
  expand(root: string, dir: string): void
  collapseAll(root: string): void
  /** Closes `dir` and every folder inside it. */
  collapseSubtree(root: string, dir: string): void
  /** Opens every folder above `path`, so its row can be drawn. */
  reveal(root: string, path: string): void
  setShowDotfiles(root: string, on: boolean): void
  setShowIgnored(root: string, on: boolean): void
  /** Reads the name filter's list, once until the next refresh. */
  loadFiles(root: string): Promise<void>
}

export type ExplorerStore = StoreApi<ExplorerState & ExplorerActions>

export const DEFAULT_PREFS: RootPrefs = { expanded: [], showDotfiles: true, showIgnored: true }

const EMPTY_GIT: GitView = { files: new Map(), folders: new Map(), ignored: new Set() }

const sameListing = (a: readonly DirEntry[] | undefined, b: readonly DirEntry[]) =>
  !!a && a.length === b.length && a.every((e, i) => e.name === b[i].name && e.isDirectory === b[i].isDirectory)

const sameMap = <V>(a: ReadonlyMap<string, V>, b: ReadonlyMap<string, V>) => a.size === b.size && [...a].every(([k, v]) => b.get(k) === v)
const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((k) => b.has(k))

const without = <T>(rec: Record<string, T>, key: string): Record<string, T> => {
  if (!(key in rec)) return rec
  const next = { ...rec }
  delete next[key]
  return next
}

const inside = (dir: string, path: string) => path === dir || path.startsWith(`${dir}/`)

export function createExplorerStore(client: ExplorerClient): ExplorerStore {
  // The newest read of each folder and worktree: a reply to an older one is dropped.
  const seq = new Map<string, number>()
  const next = (key: string) => {
    const n = (seq.get(key) ?? 0) + 1
    seq.set(key, n)
    return n
  }
  const current = (key: string, n: number) => seq.get(key) === n

  return createStore<ExplorerState & ExplorerActions>()((set, get) => {
    const prefsOf = (root: string) => get().prefs[root] ?? DEFAULT_PREFS
    const setPrefs = (root: string, change: Partial<RootPrefs>) =>
      set((s) => ({ prefs: { ...s.prefs, [root]: { ...(s.prefs[root] ?? DEFAULT_PREFS), ...change } } }))

    async function loadDir(dir: string): Promise<void> {
      const n = next(`dir:${dir}`)
      if (!get().dirs[dir]) set((s) => ({ loading: { ...s.loading, [dir]: true } }))
      try {
        const entries = await client.list(dir)
        if (!current(`dir:${dir}`, n)) return
        set((s) => ({
          dirs: sameListing(s.dirs[dir], entries) ? s.dirs : { ...s.dirs, [dir]: entries },
          loading: without(s.loading, dir),
          errors: without(s.errors, dir),
        }))
      } catch (e) {
        if (!current(`dir:${dir}`, n)) return
        // A folder that went away closes; the worktree itself keeps its error on screen.
        set((s) => ({
          dirs: without(s.dirs, dir),
          loading: without(s.loading, dir),
          errors: { ...s.errors, [dir]: String(e) },
          prefs: Object.fromEntries(Object.entries(s.prefs).map(([r, p]) => [r, p.expanded.includes(dir) ? { ...p, expanded: p.expanded.filter((d) => d !== dir) } : p])),
        }))
      }
    }

    async function loadGit(root: string): Promise<void> {
      const n = next(`git:${root}`)
      // Outside a repo, or git missing: the tree still draws, just undecorated.
      const [changes, ignored] = await Promise.all([client.changes(root).catch(() => []), client.ignored(root).catch(() => [])])
      if (!current(`git:${root}`, n)) return
      const files = fileStatuses(changes)
      const view: GitView = { files, folders: folderStatuses(files), ignored: parseIgnored(ignored) }
      const had = get().git[root]
      if (had && sameMap(had.files, view.files) && sameMap(had.folders, view.folders) && sameSet(had.ignored, view.ignored)) return
      set((s) => ({ git: { ...s.git, [root]: view } }))
    }

    async function loadFiles(root: string): Promise<void> {
      const n = next(`files:${root}`)
      if (!get().files[root]) set((s) => ({ files: { ...s.files, [root]: { paths: null, error: null } } }))
      try {
        const paths = await client.files(root)
        if (current(`files:${root}`, n)) set((s) => ({ files: { ...s.files, [root]: { paths, error: null } } }))
      } catch (e) {
        if (current(`files:${root}`, n)) set((s) => ({ files: { ...s.files, [root]: { paths: s.files[root]?.paths ?? [], error: String(e) } } }))
      }
    }

    const refresh = async (root: string) => {
      const reads = [loadDir(root), ...prefsOf(root).expanded.map(loadDir), loadGit(root)]
      if (get().files[root]) reads.push(loadFiles(root))
      await Promise.all(reads)
    }

    return {
      prefs: {},
      dirs: {},
      loading: {},
      errors: {},
      git: {},
      files: {},
      open: async (root) => {
        if (!get().prefs[root]) setPrefs(root, {})
        await refresh(root)
      },
      refresh,
      toggle: (root, dir) => {
        if (prefsOf(root).expanded.includes(dir)) setPrefs(root, { expanded: prefsOf(root).expanded.filter((d) => d !== dir) })
        else get().expand(root, dir)
      },
      expand: (root, dir) => {
        if (!prefsOf(root).expanded.includes(dir)) setPrefs(root, { expanded: [...prefsOf(root).expanded, dir] })
        void loadDir(dir)
      },
      collapseAll: (root) => setPrefs(root, { expanded: [] }),
      collapseSubtree: (root, dir) => setPrefs(root, { expanded: prefsOf(root).expanded.filter((d) => !inside(dir, d)) }),
      reveal: (root, path) => {
        const missing = ancestorsOf(root, path).filter((d) => !prefsOf(root).expanded.includes(d))
        if (missing.length === 0) return
        setPrefs(root, { expanded: [...prefsOf(root).expanded, ...missing] })
        for (const d of missing) void loadDir(d)
      },
      setShowDotfiles: (root, on) => setPrefs(root, { showDotfiles: on }),
      setShowIgnored: (root, on) => setPrefs(root, { showIgnored: on }),
      loadFiles: (root) => (get().files[root]?.paths ? Promise.resolve() : loadFiles(root)),
    }
  })
}

export const gitOf = (s: ExplorerState, root: string): GitView => s.git[root] ?? EMPTY_GIT
