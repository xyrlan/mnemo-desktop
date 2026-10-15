import { runStep } from '../cockpit/job'

/** What the chat's file mentions read of a worktree (`chat-input/catalog.ts`). Rejects with what
 *  git said. */
export type ExplorerClient = {
  /** Every file git would show: tracked, and untracked but not ignored. Relative. */
  files(root: string): Promise<string[]>
}

/** Beyond this the list reads no further: a monorepo's list is not worth a frozen menu. */
export const MAX_FILES = 200_000

// One read per worktree at a time: `job_run` refuses a second run under a live id, and a second
// caller wants the same answer anyway.
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
  files: (root) =>
    gitLines('files', root, ['ls-files', '--cached', '--others', '--exclude-standard', '--deduplicate']).then((fs) => fs.slice(0, MAX_FILES)),
}
