import { useEffect, useMemo, useState } from 'react'
import { useStore } from 'zustand'
import type { StoreApi } from 'zustand/vanilla'
import type { ChangedFile, FileSides } from './client'
import type { DiffComment } from './comment'
import { scopeOf, sidesKey, type Changes, type DiffState, type Sent } from './store'

/** What a diff's body shows, before any words are put on it: the pane and the Changes window
 *  word it each in its own look. */
export type DiffShown =
  /** The list could not be read and none was read before. */
  | { kind: 'error'; error: string }
  | { kind: 'reading' }
  /** The list is read and empty. */
  | { kind: 'none' }
  | { kind: 'file-error'; file: ChangedFile; error: string }
  | { kind: 'reading-file'; file: ChangedFile }
  | { kind: 'binary'; file: ChangedFile }
  | { kind: 'too-large'; file: ChangedFile }
  | { kind: 'diff'; file: ChangedFile; sides: FileSides }

export type DiffViewState = {
  changes: Changes | undefined
  files: ChangedFile[] | undefined
  /** The file shown: the one picked, else the first. */
  file: ChangedFile | null
  pick(path: string): void
  /** The worktree's notes, oldest first. */
  comments: DiffComment[]
  notesByFile: Map<string, number>
  sent: Sent | undefined
  totals: { add: number; del: number }
  loading: boolean
  shown: DiffShown
}

/** One worktree's changes (`base`: a branch's, since it was cut from there) as a diff view reads
 *  them: read on mount and each time the app's window comes back to the front, the shown file's
 *  sides read as it is shown. */
export function useDiffView(store: StoreApi<DiffState>, worktree: string, base?: string): DiffViewState {
  const scope = scopeOf(worktree, base)
  const changes = useStore(store, (s) => s.changes[scope])
  const allComments = useStore(store, (s) => s.comments)
  const sent = useStore(store, (s) => s.sent[worktree])
  const [picked, pick] = useState<string | null>(null)

  const files = changes?.list?.files
  const file = files?.find((f) => f.path === picked) ?? files?.[0] ?? null
  const sides = useStore(store, (s) => (file ? s.sides[sidesKey(scope, file.path)] : undefined))
  const comments = useMemo(() => allComments.filter((c) => c.worktreeId === worktree), [allComments, worktree])
  const notesByFile = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of comments) m.set(c.filePath, (m.get(c.filePath) ?? 0) + 1)
    return m
  }, [comments])

  useEffect(() => {
    if (!worktree) return
    void store.getState().load(worktree, base)
    // An agent works while the diff is open: coming back to the window reads the changes again.
    const again = () => void store.getState().load(worktree, base)
    window.addEventListener('focus', again)
    return () => window.removeEventListener('focus', again)
  }, [store, worktree, base])

  // A re-read list hands a new but equal file, so the file is keyed by its paths; its sides are
  // dropped on every re-read, and read again here.
  const fileKey = file ? `${file.path}\0${file.oldPath ?? ''}` : null
  const unread = sides === undefined
  useEffect(() => {
    if (!file || !worktree) return
    void store.getState().loadSides(worktree, file.path, file.oldPath, false, base)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, worktree, base, fileKey, unread])

  const totals = (files ?? []).reduce((t, f) => ({ add: t.add + (f.additions ?? 0), del: t.del + (f.deletions ?? 0) }), { add: 0, del: 0 })

  let shown: DiffShown
  if (changes?.error && !changes.list) shown = { kind: 'error', error: changes.error }
  else if (!files) shown = { kind: 'reading' }
  else if (!file) shown = { kind: 'none' }
  else if (sides?.error) shown = { kind: 'file-error', file, error: sides.error }
  else if (!sides?.data) shown = { kind: 'reading-file', file }
  else if (sides.data.binary || file.binary) shown = { kind: 'binary', file }
  else if (sides.data.tooLarge) shown = { kind: 'too-large', file }
  else shown = { kind: 'diff', file, sides: sides.data }

  return { changes, files, file, pick, comments, notesByFile, sent, totals, loading: changes?.loading ?? true, shown }
}
