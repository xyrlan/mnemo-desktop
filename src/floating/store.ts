import { createStore as createZustand, type StoreApi } from 'zustand/vanilla'
import type { PaneId, PtyClient } from '../pty/client'
import type { SessionClient } from '../terminal/sessions'
import {
  anchorBounds,
  clampBounds,
  defaultBounds,
  maximizedBounds,
  parseAnchored,
  resolveBounds,
  type AnchoredBounds,
  type Bounds,
  type Viewport,
} from './bounds'

/** What the floating terminal remembers across reloads and relaunches. */
export const STORAGE_KEY = 'mnemo.floating-terminal.v1'

type Sink = (b: Uint8Array) => void

export type FloatingDeps = {
  pty: PtyClient
  /** The terminals that outlived the page, as the core lists them (not the filtered view the
   *  workspace restore gets, see `hideFrom`). None: every floating shell spawns anew. */
  sessions: SessionClient | null
  /** The sink the terminal view attached for `id` (`attachSink` in the layout store), if any. */
  sinkOf(id: PaneId): Sink | undefined
  /** Calls back whenever the attached sinks change. */
  watchSinks(cb: () => void): () => void
  /** Lets go of a sink whose shell has ended. */
  forgetSink(id: PaneId): void
  storage: Storage | null
  viewport(): Viewport
}

/** The floating shell of one worktree (`key`, '' when none is open). `pty` is null while it is
 *  starting, and stays null with `error` when it could not. */
export type Shell = { key: string; pty: PaneId | null; cwd?: string; error?: string }

export type FloatingState = {
  open: boolean
  maximized: boolean
  /** Where the panel is drawn now. */
  bounds: Bounds
  /** The active worktree: its shell is the one the panel shows. */
  where: { key: string; cwd?: string }
  shells: Record<string, Shell>
}

export type FloatingActions = {
  toggle(): void
  show(): void
  hide(): void
  /** The active worktree changed; an open panel follows it, starting its shell. */
  setWhere(key: string, cwd: string | undefined): void
  toggleMaximized(): void
  /** Draws the panel at `b` (clamped) during a drag or resize, without remembering it. */
  preview(b: Bounds): void
  /** Remembers where the panel is now: the end of a drag or resize. */
  commit(): void
  /** The window was resized: the panel keeps its corner and stays on screen. */
  reconcile(): void
  /** The shells this app holds, for the workspace restore to leave alone. */
  held(): PaneId[]
  /** Forgets the remembered shells that have ended, killing the dead ones. Once, at load. */
  prune(): Promise<void>
}

export type FloatingStore = StoreApi<FloatingState & FloatingActions>

type Saved = { bounds: AnchoredBounds | null; maximized: boolean; ptys: Record<string, PaneId> }

function readSaved(storage: Storage | null): Saved {
  const none: Saved = { bounds: null, maximized: false, ptys: {} }
  try {
    const raw: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null')
    if (raw === null || typeof raw !== 'object') return none
    const r = raw as Record<string, unknown>
    const ptys: Record<string, PaneId> = {}
    if (r.ptys && typeof r.ptys === 'object') {
      for (const [k, v] of Object.entries(r.ptys)) if (Number.isInteger(v) && (v as number) > 0) ptys[k] = v as number
    }
    return { bounds: parseAnchored(r.bounds), maximized: r.maximized === true, ptys }
  } catch {
    return none
  }
}

/** A worktree's shell writes to the terminal view drawing it. Output with no view yet is kept
 *  until one attaches; what a view was handed is handed again to the next view until live output
 *  reaches one (a view mounted twice in a row, StrictMode, would otherwise draw into the first,
 *  discarded terminal). The same rule the layout store keeps for its own panes. */
export function createRouter(sinkOf: (id: PaneId) => Sink | undefined) {
  const pending = new Map<PaneId, Uint8Array[]>()
  const replay = new Map<PaneId, Uint8Array[]>()
  const fedTo = new Map<PaneId, Sink>()
  function feed(id: PaneId, sink: Sink) {
    if (fedTo.get(id) === sink) return
    fedTo.set(id, sink)
    const chunks = [...(replay.get(id) ?? []), ...(pending.get(id) ?? [])]
    pending.delete(id)
    if (chunks.length) replay.set(id, chunks)
    for (const b of chunks) sink(b)
  }
  return {
    route(id: PaneId, b: Uint8Array) {
      const sink = sinkOf(id)
      if (!sink) return void (pending.get(id)?.push(b) ?? pending.set(id, [b]))
      feed(id, sink)
      replay.delete(id)
      sink(b)
    },
    /** Output that came before any view (a reattached shell's screen), in order. */
    hold(id: PaneId, chunks: Uint8Array[]) {
      if (chunks.length) pending.set(id, [...chunks, ...(pending.get(id) ?? [])])
    },
    /** A view attached or changed: hands it what it has not drawn. */
    refresh(ids: Iterable<PaneId>) {
      for (const id of ids) {
        const sink = sinkOf(id)
        if (sink) feed(id, sink)
      }
    },
    forget(id: PaneId) {
      pending.delete(id)
      replay.delete(id)
      fedTo.delete(id)
    },
  }
}

export function createFloatingStore(deps: FloatingDeps): FloatingStore {
  const saved = readSaved(deps.storage)
  /** Where the panel goes when not maximized: remembered, else Orca's bottom-right default. */
  let committed: AnchoredBounds | null = saved.bounds
  let staged: Bounds | null = null
  /** The shells kept for each worktree across reloads, by key. */
  const ptys: Record<string, PaneId> = { ...saved.ptys }
  const router = createRouter(deps.sinkOf)

  const restingBounds = () => (committed ? resolveBounds(committed, deps.viewport()) : defaultBounds(deps.viewport()))

  function persist(maximized: boolean) {
    try {
      deps.storage?.setItem(STORAGE_KEY, JSON.stringify({ bounds: committed, maximized, ptys } satisfies Saved))
    } catch {
      // No storage: the panel is remembered for this page only.
    }
  }

  return createZustand<FloatingState & FloatingActions>((set, get) => {
    const liveIds = () => Object.values(get().shells).flatMap((s) => (s.pty === null ? [] : [s.pty]))
    deps.watchSinks(() => router.refresh(liveIds()))

    function ended(key: string, id: PaneId) {
      router.forget(id)
      deps.forgetSink(id)
      if (ptys[key] === id) {
        delete ptys[key]
        persist(get().maximized)
      }
      set((s) => {
        if (s.shells[key]?.pty !== id) return {}
        const shells = { ...s.shells }
        delete shells[key]
        // The shell shown was exited: the panel goes with it, and opens on a new one next time.
        return { shells, ...(s.where.key === key ? { open: false } : {}) }
      })
    }

    /** The shell kept for `key` from an earlier page, attached again; null when it has ended. */
    async function reattach(key: string): Promise<PaneId | null> {
      const id = ptys[key]
      if (id === undefined || !deps.sessions) return null
      const info = (await deps.sessions.list().catch(() => [])).find((i) => i.id === id)
      if (!info?.alive) {
        if (info) void deps.pty.kill(id).catch(() => {})
        delete ptys[key]
        return null
      }
      let attached = false
      const early: Uint8Array[] = []
      try {
        const screen = await deps.sessions.attach(id, (b) => (attached ? router.route(id, b) : early.push(b)))
        router.hold(id, [...(screen.length ? [screen] : []), ...early])
        attached = true
        return id
      } catch {
        delete ptys[key]
        return null
      }
    }

    async function spawn(cwd: string | undefined): Promise<PaneId> {
      let assigned: PaneId | null = null
      const early: Uint8Array[] = []
      const id = await deps.pty.spawn({
        cwd,
        cols: 80,
        rows: 24,
        onOutput: (b) => (assigned === null ? early.push(b) : router.route(assigned, b)),
      })
      assigned = id
      router.hold(id, early)
      return id
    }

    /** Starts the shell of the active worktree, unless it has one (or one is starting). */
    async function ensure() {
      const { key, cwd } = get().where
      if (get().shells[key]) return
      set((s) => ({ shells: { ...s.shells, [key]: { key, pty: null, cwd } } }))
      let id: PaneId
      try {
        id = (await reattach(key)) ?? (await spawn(cwd))
      } catch (e) {
        set((s) => ({ shells: { ...s.shells, [key]: { key, pty: null, cwd, error: String(e) } } }))
        return
      }
      ptys[key] = id
      persist(get().maximized)
      set((s) => ({ shells: { ...s.shells, [key]: { key, pty: id, cwd } } }))
      void deps.pty.onExit(id, () => ended(key, id))
      router.refresh([id])
    }

    const show = () => {
      if (get().shells[get().where.key]?.error) {
        // A shell that failed to start is tried again.
        set((s) => {
          const shells = { ...s.shells }
          delete shells[s.where.key]
          return { shells }
        })
      }
      set({ open: true })
      void ensure()
    }

    return {
      open: false,
      maximized: saved.maximized,
      bounds: saved.maximized ? maximizedBounds(deps.viewport()) : restingBounds(),
      where: { key: '' },
      shells: {},

      toggle: () => (get().open ? get().hide() : show()),
      show,
      hide: () => set({ open: false }),
      setWhere(key, cwd) {
        if (get().where.key === key && get().where.cwd === cwd) return
        set({ where: { key, cwd } })
        if (get().open) void ensure()
      },
      toggleMaximized() {
        staged = null
        const maximized = !get().maximized
        set({ maximized, bounds: maximized ? maximizedBounds(deps.viewport()) : restingBounds() })
        persist(maximized)
      },
      preview(b) {
        if (get().maximized) return
        staged = clampBounds(b, deps.viewport())
        set({ bounds: staged })
      },
      commit() {
        if (!staged) return
        const b = staged
        staged = null
        set({ bounds: b })
        const anchored = anchorBounds(b, deps.viewport())
        if (!anchored) return
        committed = anchored
        persist(get().maximized)
      },
      reconcile() {
        if (staged) return
        set({ bounds: get().maximized ? maximizedBounds(deps.viewport()) : restingBounds() })
      },
      held: () => [...new Set([...Object.values(ptys), ...liveIds()])],
      async prune() {
        if (!deps.sessions) return
        const list = await deps.sessions.list().catch(() => null)
        if (!list) return
        let changed = false
        for (const [key, id] of Object.entries(ptys)) {
          if (get().shells[key]) continue
          const info = list.find((i) => i.id === id)
          if (info?.alive) continue
          if (info) void deps.pty.kill(id).catch(() => {})
          delete ptys[key]
          changed = true
        }
        if (changed) persist(get().maximized)
      },
    }
  })
}

/** `sessions` as the workspace restore should see them: without the floating shells, which it
 *  would otherwise adopt as tabs of their own. */
export function hideFrom(sessions: SessionClient, held: () => PaneId[]): SessionClient {
  return {
    list: async () => {
      const hidden = new Set(held())
      return (await sessions.list()).filter((i) => !hidden.has(i.id))
    },
    attach: (id, onOutput) => sessions.attach(id, onOutput),
  }
}
