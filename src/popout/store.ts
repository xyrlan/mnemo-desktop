import { createStore as createZustand, type StoreApi } from 'zustand/vanilla'
import type { PaneId, PtyClient } from '../pty/client'
import { DETACH_KEY } from '../cockpit/prompt'
import { accountOf, idOf, onAccount, type Target } from '../mission/account'
import { thenLeave, typed, type Shell } from '../pty/typed'
import { clampBounds, defaultBounds, type Bounds, type Viewport } from '../floating/bounds'
import { createRouter } from '../floating/store'

/** Live sessions in popups over the app (#421, the Nexus v2 spike). Two kinds:
 *  - `pane`: a terminal already open in a pane. The popup is a second view of its PTY, drawn over
 *    the pane's (`attachSink(…, over)`): it takes the output and the size while open, and the pane
 *    is drawn again from the core's screen when it closes.
 *  - `attach`: a live background child in no pane. The popup is a PTY of its own running
 *    `claude attach <id>` on the child's account; closing it presses the detach key and ends that
 *    PTY, as the hidden attaches do (`src/mission/as-me.ts`). The child runs on: nothing here
 *    ever stops it. */

/** What the popups remember across reloads: the attach PTYs they hold, ended at the next load. */
export const STORAGE_KEY = 'mnemo.popout.v1'

type Sink = (b: Uint8Array) => void

export type PopoutDeps = {
  pty: PtyClient
  /** The shell a spawned PTY runs: the attach is typed for it. */
  shell(): Shell
  /** The sink the terminal view attached for `id` (`attachSink` in the layout store), if any. */
  sinkOf(id: PaneId): Sink | undefined
  watchSinks(cb: () => void): () => void
  forgetSink(id: PaneId): void
  storage: Storage | null
  viewport(): Viewport
}

export type Popup = {
  /** `pane:<pane id>` or `child:<session id>`: one popup each. */
  key: string
  kind: 'pane' | 'attach'
  title: string
  /** The PTY drawn: the pane's, or the attach's; null while the attach starts. */
  pty: PaneId | null
  bounds: Bounds
  error?: string
}

export type PopoutState = {
  /** Bottom to top. */
  popups: Popup[]
}

export type PopoutActions = {
  /** Pops out the terminal of pane `id`, or raises the popup showing it. */
  openPane(id: PaneId, title: string): void
  /** Pops out `claude attach` to a background child on its account, or raises the one open. */
  openChild(child: Target, title: string): Promise<void>
  close(key: string): Promise<void>
  raise(key: string): void
  /** Where popup `key` is drawn, kept on screen. */
  place(key: string, b: Bounds): void
  /** The pane under popup `pane:<id>` was closed: its popup goes too. */
  paneGone(id: PaneId): void
  /** The attach PTYs this page holds, for the workspace restore to leave alone. */
  held(): PaneId[]
}

export type PopoutStore = StoreApi<PopoutState & PopoutActions>

const COLS = 120
const ROWS = 32
/** Each popup opens this far down and right of the one under it. */
const CASCADE = 28

function readHeld(storage: Storage | null): PaneId[] {
  try {
    const raw: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((v): v is number => Number.isInteger(v) && v > 0) : []
  } catch {
    return []
  }
}

/** Ends an attach PTY: the detach key first, then the PTY. Never `claude stop`. */
async function leave(pty: PtyClient, id: PaneId) {
  await pty.write(id, DETACH_KEY).catch(() => {})
  await pty.kill(id).catch(() => {})
}

/** The attach PTYs an earlier page left: they are ended, and hidden from the workspace restore
 *  meanwhile, which would otherwise adopt each as a tab running `claude attach`. */
export function endLeftovers(deps: Pick<PopoutDeps, 'pty' | 'storage'>): PaneId[] {
  const left = readHeld(deps.storage)
  for (const id of left) void leave(deps.pty, id)
  try {
    deps.storage?.removeItem(STORAGE_KEY)
  } catch {
    // No storage: nothing was remembered either.
  }
  return left
}

export function createPopoutStore(deps: PopoutDeps): PopoutStore {
  const router = createRouter(deps.sinkOf)
  /** The attach PTYs open now. */
  const attaches = new Set<PaneId>()
  const persist = () => {
    try {
      deps.storage?.setItem(STORAGE_KEY, JSON.stringify([...attaches]))
    } catch {
      // No storage: a reload leaves the attach to the workspace restore.
    }
  }

  return createZustand<PopoutState & PopoutActions>((set, get) => {
    deps.watchSinks(() => router.refresh(attaches))

    const find = (key: string) => get().popups.find((p) => p.key === key)
    const update = (key: string, f: (p: Popup) => Popup) => set((s) => ({ popups: s.popups.map((p) => (p.key === key ? f(p) : p)) }))
    const remove = (key: string) => set((s) => ({ popups: s.popups.filter((p) => p.key !== key) }))

    function add(key: string, kind: Popup['kind'], title: string, pty: PaneId | null) {
      const vp = deps.viewport()
      const base = defaultBounds(vp)
      const n = get().popups.length
      const bounds = clampBounds({ ...base, left: base.left - n * CASCADE, top: base.top - n * CASCADE }, vp)
      set((s) => ({ popups: [...s.popups, { key, kind, title, pty, bounds }] }))
    }

    function ended(key: string, id: PaneId) {
      attaches.delete(id)
      persist()
      router.forget(id)
      deps.forgetSink(id)
      if (find(key)?.pty === id) remove(key)
    }

    return {
      popups: [],

      openPane(id, title) {
        const key = `pane:${id}`
        if (find(key)) return get().raise(key)
        add(key, 'pane', title, id)
      },

      async openChild(child, title) {
        const key = `child:${idOf(child)}`
        if (find(key)) return get().raise(key)
        add(key, 'attach', title, null)
        let id: PaneId
        try {
          let assigned: PaneId | null = null
          const early: Uint8Array[] = []
          id = await deps.pty.spawn({ cols: COLS, rows: ROWS, onOutput: (b) => (assigned === null ? early.push(b) : router.route(assigned, b)) })
          assigned = id
          router.hold(id, early)
        } catch (e) {
          update(key, (p) => ({ ...p, error: String(e) }))
          return
        }
        attaches.add(id)
        persist()
        if (!find(key)) {
          // Closed while it started.
          attaches.delete(id)
          persist()
          await leave(deps.pty, id)
          return
        }
        void deps.pty.onExit(id, () => ended(key, id))
        update(key, (p) => ({ ...p, pty: id }))
        router.refresh([id])
        // When the attach ends, the PTY ends with it: no shell is left in the popup.
        const shell = deps.shell()
        await deps.pty.write(id, typed(thenLeave(onAccount(`claude attach ${idOf(child)}`, accountOf(child), shell), shell), shell, '\r')).catch((e) => {
          update(key, (p) => ({ ...p, error: String(e) }))
        })
      },

      async close(key) {
        const p = find(key)
        if (!p) return
        remove(key)
        if (p.kind !== 'attach' || p.pty === null) return
        const id = p.pty
        attaches.delete(id)
        persist()
        router.forget(id)
        deps.forgetSink(id)
        await leave(deps.pty, id)
      },

      raise(key) {
        const p = find(key)
        if (!p || get().popups.at(-1) === p) return
        set((s) => ({ popups: [...s.popups.filter((x) => x !== p), p] }))
      },

      place(key, b) {
        update(key, (p) => ({ ...p, bounds: clampBounds(b, deps.viewport()) }))
      },

      paneGone(id) {
        if (find(`pane:${id}`)) remove(`pane:${id}`)
      },

      held: () => [...attaches],
    }
  })
}
