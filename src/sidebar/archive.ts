// adapted from stablyai/orca components/workspace-cleanup/use-workspace-cleanup-removal.ts,
// use-workspace-cleanup-scan-lifecycle.ts and workspace-cleanup-selection-model.ts (MIT,
// 122b8c25): scanning for stale worktrees, the selection, and removing in one batch — here one
// zustand store instead of Orca's slice and hooks.
import type { RepoNode, WorktreeNode } from '../fleet/types'
import { archiveStore, closedCleanup, type ArchiveState } from './archive-store'
import { classify, isLive, isStale, keptSummary, type Candidate } from './cleanup-model'
import { norm } from './model'
import { cleanupFacts, fleetStore, forgetProject, layoutStore, listWorktrees, removeWorktree, toast } from './upstream'

export { archiveStore, useArchive, type ArchiveState, type AskRemove } from './archive-store'

const setCleanup = (patch: Partial<ArchiveState['cleanup']>) =>
  archiveStore.setState((s) => ({ cleanup: { ...s.cleanup, ...patch } }))

function mark(paths: readonly string[], on: boolean) {
  archiveStore.setState((s) => {
    const removing = new Set(s.removing)
    for (const p of paths) (on ? removing.add(p) : removing.delete(p))
    return { removing }
  })
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Removes one worktree (its branch stays) and closes its panes. The fleet is not refreshed. */
async function removeOne(path: string, force: boolean) {
  await removeWorktree(path, force)
  await layoutStore.getState().closeWorktree(path)
}

/** Remove the worktree now: the backend refuses a dirty one unless `force`. Its card says
 *  "Removing…" until the fleet has dropped it; a failure is a toast. */
export async function removeWorkspace(tree: Pick<WorktreeNode, 'path' | 'name' | 'branch'>, force: boolean): Promise<boolean> {
  mark([tree.path], true)
  try {
    await removeOne(tree.path, force)
    await fleetStore.getState().refresh()
    toast.success(`Removed ${tree.name}`, { description: tree.branch ? `Branch ${tree.branch} is kept.` : undefined })
    return true
  } catch (e) {
    toast.error(`Could not remove ${tree.name}`, { description: message(e) })
    return false
  } finally {
    mark([tree.path], false)
  }
}

/** A card's "Remove workspace": straight away when nothing would be lost, else asked first. */
export async function requestRemove(tree: WorktreeNode): Promise<void> {
  if (tree.kind === 'main' || archiveStore.getState().removing.has(tree.path)) return
  let dirty: boolean
  try {
    const listed = (await listWorktrees(tree.path)).find((w) => norm(w.path) === tree.path)
    if (!listed) throw new Error(`git does not list ${tree.path} as a worktree`)
    dirty = listed.dirty
  } catch (e) {
    toast.error(`Could not remove ${tree.name}`, { description: message(e) })
    return
  }
  const live = tree.agents.filter(isLive).length
  if (dirty || live > 0) {
    archiveStore.setState({ ask: { path: tree.path, name: tree.name, branch: tree.branch, dirty, live } })
    return
  }
  await removeWorkspace(tree, false)
}

/** The answer to `ask`: yes removes it, forcing past its changes; no leaves it. */
export async function answerRemove(yes: boolean): Promise<void> {
  const ask = archiveStore.getState().ask
  archiveStore.setState({ ask: null })
  if (yes && ask) await removeWorkspace(ask, ask.dirty)
}

let scanSeq = 0

/** Look at every non-main worktree of every repo; the stale ones become the list. A scan started
 *  later wins: an earlier one's answer is dropped. */
export async function scanCleanup(): Promise<void> {
  const seq = ++scanSeq
  setCleanup({ scanning: true, errors: [] })
  const repos: readonly RepoNode[] = fleetStore.getState().repos
  const judged = await Promise.all(
    repos.map(async (repo) => {
      const trees = repo.worktrees.filter((w) => w.kind !== 'main')
      if (trees.length === 0) return { all: [] as Candidate[], error: null }
      try {
        const facts = await cleanupFacts(repo.root)
        return { all: trees.map((t) => classify(repo, t, facts)), error: null }
      } catch (e) {
        return { all: [] as Candidate[], error: `${repo.name}: ${message(e)}` }
      }
    }),
  )
  if (seq !== scanSeq) return
  const all = judged.flatMap((j) => j.all)
  const candidates = all.filter(isStale)
  const paths = new Set(candidates.map((c) => c.path))
  archiveStore.setState((s) => ({
    cleanup: {
      ...s.cleanup,
      scanning: false,
      candidates,
      kept: keptSummary(all.filter((c) => !isStale(c))),
      errors: judged.flatMap((j) => (j.error ? [j.error] : [])),
      // A worktree that stopped being stale leaves the selection with its row.
      selected: new Set([...s.cleanup.selected].filter((p) => paths.has(p))),
    },
  }))
}

/** `worktree.cleanup`: the cleanup view, scanned afresh, nothing selected. */
export function openCleanup() {
  archiveStore.setState({ cleanup: { ...closedCleanup, open: true } })
  void scanCleanup()
}

/** Close it. A batch that is running keeps going; its cards still say "Removing…". */
export function closeCleanup() {
  scanSeq++
  setCleanup({ open: false, scanning: false })
}

export function toggleSelected(path: string) {
  const selected = new Set(archiveStore.getState().cleanup.selected)
  if (!selected.delete(path)) selected.add(path)
  setCleanup({ selected })
}

/** Select every row, or none. */
export function selectAll(on: boolean) {
  const { candidates, progress } = archiveStore.getState().cleanup
  if (progress) return
  setCleanup({ selected: new Set(on ? candidates.map((c) => c.path) : []) })
}

/** The selection, in list order. */
export function selectedCandidates(s: ArchiveState['cleanup']): Candidate[] {
  return s.candidates.filter((c) => s.selected.has(c.path))
}

export function confirmCleanup() {
  if (selectedCandidates(archiveStore.getState().cleanup).length > 0) setCleanup({ step: 'confirm' })
}

export function backToList() {
  if (!archiveStore.getState().cleanup.progress) setCleanup({ step: 'list' })
}

/** Remove the selection one at a time (git locks the repo's worktree list), none forced: each
 *  was clean when scanned, and one that changed since is refused and says why on its row. */
export async function removeSelected(): Promise<void> {
  const s = archiveStore.getState().cleanup
  const batch = selectedCandidates(s)
  if (batch.length === 0 || s.progress) return
  const total = batch.length
  setCleanup({ progress: { done: 0, failed: 0, total }, failures: {} })
  mark(batch.map((c) => c.path), true)
  const failures: Record<string, string> = {}
  let done = 0
  for (const c of batch) {
    try {
      await removeOne(c.path, false)
      done++
    } catch (e) {
      failures[c.path] = message(e)
    }
    setCleanup({ progress: { done, failed: Object.keys(failures).length, total } })
  }
  try {
    await fleetStore.getState().refresh()
  } finally {
    mark(batch.map((c) => c.path), false)
  }
  const removed = new Set(batch.filter((c) => !(c.path in failures)).map((c) => c.path))
  archiveStore.setState((st) => ({
    cleanup: {
      ...st.cleanup,
      step: 'list',
      progress: null,
      failures,
      candidates: st.cleanup.candidates.filter((c) => !removed.has(c.path)),
      selected: new Set([...st.cleanup.selected].filter((p) => !removed.has(p))),
    },
  }))
  const failed = Object.keys(failures).length
  if (failed === 0) toast.success(`Removed ${done} ${done === 1 ? 'workspace' : 'workspaces'}`, { description: 'Their branches are kept.' })
  else toast.error(`Removed ${done} of ${total} workspaces`, { description: `${failed} could not be removed; each says why.` })
}

/** A repo header's "Forget project": off the project list, its folders left alone. */
export async function forgetRepo(repo: Pick<RepoNode, 'root' | 'name'>): Promise<void> {
  try {
    await forgetProject(repo.root)
    await fleetStore.getState().refresh()
  } catch (e) {
    toast.error(`Could not forget ${repo.name}`, { description: message(e) })
  }
}
