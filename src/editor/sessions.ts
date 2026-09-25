import { createStore as createZustand, type StoreApi } from 'zustand/vanilla'

/** Per-pane editor state. Lives outside React because SplitView remounts a leaf whenever
 *  its pane is split, and outside the layout store because that store is not ours.
 *  Buffers (Monaco models) are kept alongside, keyed the same way, for the same reason. */
export type Session = {
  path: string
  /** Root for shortening the path and resolving relative ones; null until the default (focused terminal cwd, else home) is resolved. */
  root: string | null
  dirty: boolean
  /** A file the user asked to open while the buffer was dirty. */
  pending?: string
  error?: string
}

export type Buffer = { path: string; model: { dispose(): void }; savedVersion: number }

export type SessionsState = {
  sessions: Record<number, Session>
  open(id: number, path: string, root: string | null): void
  setRoot(id: number, root: string): void
  /** Opens `path` in the pane, or parks it in `pending` while the buffer is dirty. */
  navigate(id: number, path: string): void
  /** Opens the pending file, dropping unsaved edits. */
  discard(id: number): void
  cancelPending(id: number): void
  setDirty(id: number, dirty: boolean): void
  setError(id: number, error?: string): void
  /** Forgets every pane not in `live` and disposes its buffer. */
  prune(live: Iterable<number>): void
}

export type Sessions = StoreApi<SessionsState> & { buffers: Map<number, Buffer> }

export function createSessions(): Sessions {
  const buffers = new Map<number, Buffer>()
  const store = createZustand<SessionsState>((set, get) => {
    const patch = (id: number, p: Partial<Session>) => {
      const s = get().sessions[id]
      if (s) set({ sessions: { ...get().sessions, [id]: { ...s, ...p } } })
    }
    return {
      sessions: {},
      open(id, path, root) {
        if (get().sessions[id]) return
        set({ sessions: { ...get().sessions, [id]: { path, root, dirty: false } } })
      },
      setRoot: (id, root) => patch(id, { root }),
      navigate(id, path) {
        const s = get().sessions[id]
        if (!s || s.path === path) return patch(id, { pending: undefined })
        if (s.dirty) patch(id, { pending: path })
        else patch(id, { path, pending: undefined, error: undefined })
      },
      discard(id) {
        const s = get().sessions[id]
        if (s?.pending) patch(id, { path: s.pending, pending: undefined, dirty: false, error: undefined })
      },
      cancelPending: (id) => patch(id, { pending: undefined }),
      setDirty(id, dirty) {
        if (get().sessions[id]?.dirty !== dirty) patch(id, { dirty })
      },
      setError: (id, error) => patch(id, { error }),
      prune(live) {
        const keep = new Set(live)
        const dead = Object.keys(get().sessions).map(Number).filter((id) => !keep.has(id))
        for (const id of [...buffers.keys()]) {
          if (!keep.has(id)) {
            buffers.get(id)!.model.dispose()
            buffers.delete(id)
          }
        }
        if (dead.length === 0) return
        const sessions = { ...get().sessions }
        for (const id of dead) delete sessions[id]
        set({ sessions })
      },
    }
  })
  return Object.assign(store, { buffers })
}
