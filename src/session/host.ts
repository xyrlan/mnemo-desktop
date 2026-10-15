import { createStore as createZustand, type StoreApi } from 'zustand/vanilla'
import type { PaneId, PtyClient } from '../pty/client'
import { DETACH_KEY } from '../cockpit/prompt'
import { accountOf, idOf, onAccount, type Target } from '../mission/account'
import { thenLeave, typed, type Shell } from '../pty/typed'

/** The session host (#423): the live sessions shown outside their panes, keyed by session, for
 *  every presentation of them (the popups of `src/popout`, the Nexus drawer). A presentation holds
 *  a session while it shows it and lets go when it stops; the host starts and ends what a session
 *  needs, and nothing about where or how it is drawn.
 *
 *  Two kinds:
 *  - `pane`: a terminal already open in a pane. Nothing is started: a presentation draws the
 *    pane's PTY with the terminal view (`src/terminal/view.tsx`, `present`), a view of its own
 *    beside the pane's. Whichever view the user sees owns the PTY (`attachSink` in the layout
 *    store).
 *  - `attach`: a live background child in no pane. The host spawns a PTY running
 *    `claude attach <id>` on the child's account at the first hold, and at the last let-go presses
 *    the detach key and ends that PTY, as the hidden attaches do (`src/mission/as-me.ts`). The
 *    child runs on: nothing here ever stops it.
 *
 *  The attach PTYs are remembered across reloads in one list, and ended at the next load
 *  (`endLeftovers`); `held` keeps them out of the workspace restore meanwhile. */

/** What the host remembers across reloads: the attach PTYs it holds, ended at the next load. */
export const STORAGE_KEY = 'mnemo.session-host.v1'

/** A session to show: a pane's, or a background child's. */
export type SessionRef = { pane: PaneId } | { child: Target }

/** `pane:<pane id>` or `child:<session id>`: one per session, whoever shows it. */
export type SessionKey = string

export type HostedSession = {
  key: SessionKey
  kind: 'pane' | 'attach'
  /** The PTY to draw: the pane's, or the attach's; null while the attach starts or when it could
   *  not (`error`). */
  pty: PaneId | null
  error?: string
  /** The presentations holding it, by the name each passed to `hold`. */
  by: string[]
}

export type SessionHostState = {
  /** Every session held now. One goes when its last holder lets go, its attach ends by itself,
   *  or its pane is closed: a presentation drops what is no longer here. */
  sessions: Record<SessionKey, HostedSession>
}

export type SessionHostActions = {
  /** Presentation `by` shows session `ref` from now on; the key it is held under. The first hold
   *  of a child starts its attach. Holding again what `by` holds changes nothing. */
  hold(ref: SessionRef, by: string): SessionKey
  /** Presentation `by` no longer shows session `key`. The last let-go of an attach detaches it and
   *  ends its PTY (also while it is still starting); a pane's session ends nothing. */
  release(key: SessionKey, by: string): Promise<void>
  /** Pane `id` was closed: its session goes, for every holder. */
  paneGone(id: PaneId): void
  /** The attach PTYs this page holds, for the workspace restore to leave alone. */
  held(): PaneId[]
}

export type SessionHost = StoreApi<SessionHostState & SessionHostActions>

export type SessionHostDeps = {
  pty: PtyClient
  /** The shell a spawned PTY runs: the attach is typed for it. */
  shell(): Shell
  /** Output of an attach PTY, for its views (`feedTerminal` in the layout store). */
  feed(id: PaneId, b: Uint8Array): void
  /** An attach PTY ended: its views get nothing more (`forgetTerminal` in the layout store). */
  forget(id: PaneId): void
  storage: Storage | null
}

export function sessionKey(ref: SessionRef): SessionKey {
  return 'pane' in ref ? `pane:${ref.pane}` : `child:${idOf(ref.child)}`
}

const COLS = 120
const ROWS = 32

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
export function endLeftovers(deps: Pick<SessionHostDeps, 'pty' | 'storage'>): PaneId[] {
  const left = readHeld(deps.storage)
  for (const id of left) void leave(deps.pty, id)
  try {
    deps.storage?.removeItem(STORAGE_KEY)
  } catch {
    // No storage: nothing was remembered either.
  }
  return left
}

export function createSessionHost(deps: SessionHostDeps): SessionHost {
  /** The attach PTYs open now, each with the exit listener to remove when it is ended. */
  const attaches = new Map<PaneId, { unlisten: Promise<() => void> }>()
  /** The hold that started each attach session: a spawn that resolves after its session was let go,
   *  and maybe held again since, is not this one's (#423). */
  const starts = new Map<SessionKey, object>()
  const persist = () => {
    try {
      deps.storage?.setItem(STORAGE_KEY, JSON.stringify([...attaches.keys()]))
    } catch {
      // No storage: a reload leaves the attach to the workspace restore.
    }
  }

  return createZustand<SessionHostState & SessionHostActions>((set, get) => {
    const update = (key: SessionKey, f: (s: HostedSession) => HostedSession) =>
      set((st) => (st.sessions[key] ? { sessions: { ...st.sessions, [key]: f(st.sessions[key]) } } : {}))
    const drop = (key: SessionKey) =>
      set((st) => {
        if (!st.sessions[key]) return {}
        const sessions = { ...st.sessions }
        delete sessions[key]
        return { sessions }
      })

    /** Lets go of attach PTY `id`: its exit listener, the list, its views. */
    function forget(id: PaneId) {
      void attaches.get(id)?.unlisten.then((off) => off())
      attaches.delete(id)
      persist()
      deps.forget(id)
    }

    /** The attach ended by itself: its session goes with it. */
    function ended(key: SessionKey, id: PaneId) {
      if (!attaches.has(id)) return
      forget(id)
      if (get().sessions[key]?.pty === id) {
        starts.delete(key)
        drop(key)
      }
    }

    async function start(key: SessionKey, child: Target, token: object) {
      const mine = () => starts.get(key) === token
      let id: PaneId
      try {
        let assigned: PaneId | null = null
        const early: Uint8Array[] = []
        id = await deps.pty.spawn({ cols: COLS, rows: ROWS, onOutput: (b) => (assigned === null ? early.push(b) : deps.feed(assigned, b)) })
        assigned = id
        for (const b of early) deps.feed(id, b)
      } catch (e) {
        if (mine()) update(key, (s) => ({ ...s, error: String(e) }))
        return
      }
      attaches.set(id, { unlisten: deps.pty.onExit(id, () => ended(key, id)) })
      persist()
      if (!mine()) {
        // Let go of while it started.
        forget(id)
        await leave(deps.pty, id)
        return
      }
      update(key, (s) => ({ ...s, pty: id }))
      // When the attach ends, the PTY ends with it: no shell is left in the view.
      const shell = deps.shell()
      await deps.pty.write(id, typed(thenLeave(onAccount(`claude attach ${idOf(child)}`, accountOf(child), shell), shell), shell, '\r')).catch((e) => {
        if (mine()) update(key, (s) => ({ ...s, error: String(e) }))
      })
    }

    return {
      sessions: {},

      hold(ref, by) {
        const key = sessionKey(ref)
        const had = get().sessions[key]
        if (had) {
          if (!had.by.includes(by)) update(key, (s) => ({ ...s, by: [...s.by, by] }))
          return key
        }
        if ('pane' in ref) {
          set((st) => ({ sessions: { ...st.sessions, [key]: { key, kind: 'pane', pty: ref.pane, by: [by] } } }))
          return key
        }
        const token = {}
        starts.set(key, token)
        set((st) => ({ sessions: { ...st.sessions, [key]: { key, kind: 'attach', pty: null, by: [by] } } }))
        void start(key, ref.child, token)
        return key
      },

      async release(key, by) {
        const s = get().sessions[key]
        if (!s?.by.includes(by)) return
        if (s.by.length > 1) return update(key, (x) => ({ ...x, by: x.by.filter((b) => b !== by) }))
        drop(key)
        starts.delete(key)
        if (s.kind !== 'attach' || s.pty === null) return
        forget(s.pty)
        await leave(deps.pty, s.pty)
      },

      paneGone(id) {
        drop(`pane:${id}`)
      },

      held: () => [...attaches.keys()],
    }
  })
}
