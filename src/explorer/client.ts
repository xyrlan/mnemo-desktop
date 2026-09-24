import { tauriFs } from '../editor/client'
import { tauriCommit, type Change } from '../commit/client'
import { runStep } from '../cockpit/job'
import type { DirEntry } from './types'

/** What the explorer reads. Every call rejects with what the backend said. */
export type ExplorerClient = {
  /** One folder's entries, folders first (`fs_list`). */
  list(dir: string): Promise<DirEntry[]>
  /** The worktree's changed paths, relative to its root (`commit_status`). */
  changes(root: string): Promise<Change[]>
  /** What git ignores in the worktree, relative; an ignored folder once, with a trailing `/`. */
  ignored(root: string): Promise<string[]>
  /** Every file git would show: tracked, and untracked but not ignored. Relative. */
  files(root: string): Promise<string[]>
}

/** Beyond this the name filter reads no further: a monorepo's list is not worth a frozen panel. */
export const MAX_FILES = 200_000

// One read per worktree and kind at a time: `job_run` refuses a second run under a live id, and a
// second caller wants the same answer anyway.
const inflight = new Map<string, Promise<string[]>>()

function gitLines(kind: string, root: string, args: string[]): Promise<string[]> {
  const id = `explorer-${kind}:${root}`
  const running = inflight.get(id)
  if (running) return running
  // `core.quotePath=false`: a name with non-ASCII letters comes back as itself, not octal escapes.
  const p = runStep(id, root, ['git', '-c', 'core.quotePath=false', ...args])
    .then(({ code, out, err }) => {
      if (code !== 0) throw new Error(err.join('\n').trim() || `git exited with ${code}`)
      return out.filter(Boolean)
    })
    .finally(() => inflight.delete(id))
  inflight.set(id, p)
  return p
}

export const tauriExplorer: ExplorerClient = {
  list: (dir) => tauriFs.list(dir).then((es) => es.map((e) => ({ name: e.name, isDirectory: e.is_dir }))),
  changes: (root) => tauriCommit.status(root).then((s) => s.changes),
  ignored: (root) => gitLines('ignored', root, ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory']),
  files: (root) =>
    gitLines('files', root, ['ls-files', '--cached', '--others', '--exclude-standard', '--deduplicate']).then((fs) => fs.slice(0, MAX_FILES)),
}
