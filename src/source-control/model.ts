// adapted from stablyai/orca components/right-sidebar/source-control/listing/entry-actions.ts,
// section-order.ts and commit/discard-confirmation.ts
import type { ScmArea, ScmEntry } from './client'

export type Section = { area: ScmArea; title: string; entries: ScmEntry[] }

const TITLES: Record<ScmArea, string> = {
  conflicted: 'Conflicts',
  staged: 'Staged Changes',
  unstaged: 'Changes',
  untracked: 'Untracked Files',
}

/** Orca's order: what blocks a commit first, then what it would carry, then the rest. */
const ORDER: ScmArea[] = ['conflicted', 'staged', 'unstaged', 'untracked']

/** The non-empty sections, in order; each keeps git's order of its files. */
export function sectionsOf(entries: readonly ScmEntry[]): Section[] {
  return ORDER.map((area) => ({ area, title: TITLES[area], entries: entries.filter((e) => e.area === area) })).filter((s) => s.entries.length > 0)
}

export const entryKey = (e: Pick<ScmEntry, 'area' | 'path'>) => `${e.area}:${e.path}`

/** Staging a conflicted file marks it resolved, as `git add` does. */
export const canStage = (e: ScmEntry) => e.area !== 'staged'
export const canUnstage = (e: ScmEntry) => e.area === 'staged'
/** A conflict is resolved first, and a staged change unstaged first: discard only ever drops
 *  what is not staged. */
export const canDiscard = (e: ScmEntry) => (e.area === 'unstaged' || e.area === 'untracked') && !isFolder(e)
/** A repository nested in the tree, which git lists as one untracked `folder/`; never deleted
 *  from here. */
export const isFolder = (e: ScmEntry) => e.path.endsWith('/')

/** The paths to hand git to unstage `entries`: a rename by both of its paths. */
export function unstagePaths(entries: readonly ScmEntry[]): string[] {
  const out = new Set<string>()
  for (const e of entries) {
    out.add(e.path)
    if (e.oldPath) out.add(e.oldPath)
  }
  return [...out]
}

/** `entries` to discard, split as the core takes them: tracked changes to revert, untracked
 *  files to delete. */
export function discardPaths(entries: readonly ScmEntry[]): { tracked: string[]; untracked: string[] } {
  const d = entries.filter(canDiscard)
  return { tracked: d.filter((e) => e.area === 'unstaged').map((e) => e.path), untracked: d.filter((e) => e.area === 'untracked').map((e) => e.path) }
}

/** What is about to be discarded: one file, or every discardable file of a section. */
export type PendingDiscard = { kind: 'entry'; entry: ScmEntry } | { kind: 'area'; area: 'unstaged' | 'untracked'; entries: ScmEntry[] }

export type DiscardCopy = { title: string; description: string; confirm: string; deletes: boolean }

const trimmed = (p: string) => p.replace(/\/+$/, '')
export const baseName = (p: string) => trimmed(p).slice(trimmed(p).lastIndexOf('/') + 1)
export const dirName = (p: string) => (trimmed(p).includes('/') ? trimmed(p).slice(0, trimmed(p).lastIndexOf('/')) : '')

/** The confirm dialog's words: "delete" when the file goes, since it has no version to go back to. */
export function discardCopy(p: PendingDiscard): DiscardCopy {
  if (p.kind === 'entry') {
    const name = baseName(p.entry.path)
    if (p.entry.area === 'untracked' || p.entry.status === 'added')
      return { title: `Delete "${name}"?`, description: 'This will permanently delete this file. This cannot be undone.', confirm: 'Delete', deletes: true }
    if (p.entry.status === 'deleted')
      return { title: `Restore "${name}"?`, description: 'This will bring the file back and discard its deletion. This cannot be undone.', confirm: 'Restore', deletes: false }
    return { title: `Discard changes to "${name}"?`, description: 'This will revert every unstaged change to this file. This cannot be undone.', confirm: 'Discard', deletes: false }
  }
  const n = p.entries.length
  if (p.area === 'untracked')
    return {
      title: n === 1 ? 'Delete 1 untracked file?' : `Delete ${n} untracked files?`,
      description: n === 1 ? 'This will permanently delete this untracked file. This cannot be undone.' : `This will permanently delete these ${n} untracked files. This cannot be undone.`,
      confirm: n === 1 ? 'Delete' : `Delete ${n}`,
      deletes: true,
    }
  return {
    title: 'Discard all unstaged changes?',
    description: n === 1 ? 'This will revert the unstaged changes in 1 file. This cannot be undone.' : `This will revert the unstaged changes in ${n} files. This cannot be undone.`,
    confirm: 'Discard all',
    deletes: false,
  }
}
