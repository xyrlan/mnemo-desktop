import { createStore, type StoreApi } from 'zustand/vanilla'
import type { DiffComment } from './comment'
import type { ChangeList, DiffClient, FileSides } from './client'
import { formatDiffComments } from './format'
import { sendTo, type SendDeps, type Target } from './deliver'

/** One worktree's change list as last read. */
export type Changes = { list: ChangeList | null; loading: boolean; error: string | null }
/** One file's sides as last read. */
export type Sides = { data: FileSides | null; loading: boolean; error: string | null }
/** What the last send did, shown in the diff's header until the next one. */
export type Sent = { sending: boolean; ok: string | null; error: string | null }

export type DiffState = {
  /** By `scopeOf(worktree, base)`. */
  changes: Record<string, Changes>
  /** By `sidesKey(scopeOf(worktree, base), file)`. */
  sides: Record<string, Sides>
  /** Every worktree's notes, oldest first. Kept across launches. */
  comments: DiffComment[]
  /** By worktree path. */
  sent: Record<string, Sent>
  /** Read the worktree's changed files again, and forget the sides read before. With `base`, the
   *  branch's changes since it was cut from there (empty: the default branch). */
  load(worktree: string, base?: string): Promise<void>
  /** Read one file's sides, unless they are read already (`force`: again). */
  loadSides(worktree: string, file: string, oldPath: string | null, force?: boolean, base?: string): Promise<void>
  addComment(c: Omit<DiffComment, 'id' | 'createdAt'>): DiffComment
  updateComment(id: string, body: string): void
  deleteComment(id: string): void
  /** Send the worktree's notes (`ids`: only those) to its agent in one message; the notes that
   *  went are dropped, as Orca drops delivered notes. False, with the reason in `sent`, when
   *  nothing went. */
  send(worktree: string, ids?: readonly string[]): Promise<boolean>
}

/** Where a worktree's changes are kept: the uncommitted ones under the path itself, a branch's
 *  under the path and its base, so the two views of one worktree never overwrite each other. */
export const scopeOf = (worktree: string, base?: string) => (base === undefined ? worktree : `${worktree}\u0001${base}`)

export const sidesKey = (worktree: string, file: string) => `${worktree}\0${file}`

export type DiffDeps = {
  client: DiffClient
  /** Who reads the worktree's notes now; null when no agent runs there. */
  target(worktree: string): Target | null
  deliver: SendDeps
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null
  now?: () => number
  newId?: () => string
}

/** Where notes are kept between launches. */
export const STORAGE_KEY = 'mnemo-desktop.diff-comments'

function isComment(x: unknown): x is DiffComment {
  if (!x || typeof x !== 'object') return false
  const c = x as Record<string, unknown>
  return (
    typeof c.id === 'string' &&
    typeof c.worktreeId === 'string' &&
    typeof c.filePath === 'string' &&
    typeof c.lineNumber === 'number' &&
    typeof c.body === 'string' &&
    typeof c.createdAt === 'number' &&
    (c.startLine === undefined || typeof c.startLine === 'number') &&
    (c.quote === undefined || typeof c.quote === 'string')
  )
}

/** The notes `raw` (the stored JSON) holds; anything malformed is left out. */
export function readKept(raw: string | null): DiffComment[] {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter(isComment) : []
  } catch {
    return []
  }
}

const plural = (n: number) => `${n} ${n === 1 ? 'note' : 'notes'}`

export function createDiffStore(deps: DiffDeps): StoreApi<DiffState> {
  const now = deps.now ?? Date.now
  let seq = 0
  const newId = deps.newId ?? (() => `${now().toString(36)}-${(seq++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`)
  let kept: DiffComment[] = []
  try {
    kept = readKept(deps.storage?.getItem(STORAGE_KEY) ?? null)
  } catch {
    // Storage the webview refuses: no notes from before.
  }
  // A reply that lands after a newer read of the same thing is dropped.
  const loads = new Map<string, number>()
  const turn = (key: string) => {
    const n = (loads.get(key) ?? 0) + 1
    loads.set(key, n)
    return () => loads.get(key) === n
  }

  const store = createStore<DiffState>((set, get) => ({
    changes: {},
    sides: {},
    comments: kept,
    sent: {},

    async load(worktree, base) {
      const scope = scopeOf(worktree, base)
      const current = turn(`files\0${scope}`)
      set((s) => ({
        changes: { ...s.changes, [scope]: { list: s.changes[scope]?.list ?? null, loading: true, error: null } },
        // The sides read before may be stale now; each is read again when shown.
        sides: Object.fromEntries(Object.entries(s.sides).filter(([k]) => !k.startsWith(`${scope}\0`))),
      }))
      try {
        const list = await (base === undefined ? deps.client.files(worktree) : deps.client.files(worktree, base))
        if (current()) set((s) => ({ changes: { ...s.changes, [scope]: { list, loading: false, error: null } } }))
      } catch (e) {
        if (current()) set((s) => ({ changes: { ...s.changes, [scope]: { list: s.changes[scope]?.list ?? null, loading: false, error: String(e) } } }))
      }
    },

    async loadSides(worktree, file, oldPath, force = false, base) {
      const key = sidesKey(scopeOf(worktree, base), file)
      const had = get().sides[key]
      if (had && !force && (had.data || had.loading)) return
      const current = turn(`sides\0${key}`)
      set((s) => ({ sides: { ...s.sides, [key]: { data: had?.data ?? null, loading: true, error: null } } }))
      try {
        const data = await (base === undefined ? deps.client.sides(worktree, file, oldPath) : deps.client.sides(worktree, file, oldPath, base))
        if (current()) set((s) => ({ sides: { ...s.sides, [key]: { data, loading: false, error: null } } }))
      } catch (e) {
        if (current()) set((s) => ({ sides: { ...s.sides, [key]: { data: null, loading: false, error: String(e) } } }))
      }
    },

    addComment(c) {
      const made: DiffComment = { ...c, id: newId(), createdAt: now() }
      set((s) => ({ comments: [...s.comments, made] }))
      return made
    },
    updateComment(id, body) {
      set((s) => ({ comments: s.comments.map((c) => (c.id === id ? { ...c, body } : c)) }))
    },
    deleteComment(id) {
      set((s) => ({ comments: s.comments.filter((c) => c.id !== id) }))
    },

    async send(worktree, ids) {
      const notes = get().comments.filter((c) => c.worktreeId === worktree && (!ids || ids.includes(c.id)))
      const fail = (error: string) => {
        set((s) => ({ sent: { ...s.sent, [worktree]: { sending: false, ok: null, error } } }))
        return false
      }
      if (notes.length === 0) return fail('No notes to send.')
      if (get().sent[worktree]?.sending) return false
      const target = deps.target(worktree)
      if (!target) return fail('No agent runs in this worktree: start Claude in one of its terminals, then send again.')
      set((s) => ({ sent: { ...s.sent, [worktree]: { sending: true, ok: null, error: null } } }))
      try {
        await sendTo(target, formatDiffComments(notes), deps.deliver)
      } catch (e) {
        return fail(`Could not send to ${target.label}: ${e}`)
      }
      const gone = new Set(notes.map((c) => c.id))
      set((s) => ({
        comments: s.comments.filter((c) => !gone.has(c.id)),
        sent: { ...s.sent, [worktree]: { sending: false, ok: `Sent ${plural(notes.length)} to ${target.label}.`, error: null } },
      }))
      return true
    },
  }))

  if (deps.storage) {
    const storage = deps.storage
    store.subscribe((s, p) => {
      if (s.comments === p.comments) return
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(s.comments))
      } catch {
        // Full or refused: the notes still work, they are just forgotten on quit.
      }
    })
  }
  return store
}
