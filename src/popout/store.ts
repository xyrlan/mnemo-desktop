import { createStore as createZustand, type StoreApi } from 'zustand/vanilla'
import type { PaneId } from '../pty/client'
import type { Target } from '../mission/account'
import { clampBounds, defaultBounds, type Bounds, type Viewport } from '../floating/bounds'
import type { SessionHost, SessionKey } from '../session/host'

/** Live sessions in popups over the app (#421): one presentation of the session host
 *  (`src/session/host.ts`), which starts and ends what each session needs. This keeps only what a
 *  popup is: which sessions have one, its title, where it is drawn and which is on top. */

/** The name the popups hold their sessions under. */
export const BY = 'popout'

export type PopoutDeps = {
  host: SessionHost
  viewport(): Viewport
}

export type Popup = {
  /** The session's key in the host: one popup each. */
  key: SessionKey
  title: string
  bounds: Bounds
}

export type PopoutState = {
  /** Bottom to top. */
  popups: Popup[]
}

export type PopoutActions = {
  /** Pops out the terminal of pane `id`, or raises the popup showing it. */
  openPane(id: PaneId, title: string): void
  /** Pops out `claude attach` to a background child on its account, or raises the one open. */
  openChild(child: Target, title: string): void
  close(key: SessionKey): Promise<void>
  raise(key: SessionKey): void
  /** Where popup `key` is drawn, kept on screen. */
  place(key: SessionKey, b: Bounds): void
}

export type PopoutStore = StoreApi<PopoutState & PopoutActions>

/** Each popup opens this far down and right of the one under it. */
const CASCADE = 28

export function createPopoutStore(deps: PopoutDeps): PopoutStore {
  return createZustand<PopoutState & PopoutActions>((set, get) => {
    const find = (key: SessionKey) => get().popups.find((p) => p.key === key)
    const remove = (key: SessionKey) => set((s) => ({ popups: s.popups.filter((p) => p.key !== key) }))

    // A session the host no longer has (its attach ended, its pane closed) takes its popup.
    deps.host.subscribe((h) => {
      const gone = get().popups.filter((p) => !h.sessions[p.key])
      if (gone.length) set((s) => ({ popups: s.popups.filter((p) => !gone.includes(p)) }))
    })

    function open(key: SessionKey, title: string) {
      if (find(key)) return get().raise(key)
      const vp = deps.viewport()
      const base = defaultBounds(vp)
      const n = get().popups.length
      const bounds = clampBounds({ ...base, left: base.left - n * CASCADE, top: base.top - n * CASCADE }, vp)
      set((s) => ({ popups: [...s.popups, { key, title, bounds }] }))
    }

    return {
      popups: [],

      openPane(id, title) {
        open(deps.host.getState().hold({ pane: id }, BY), title)
      },

      openChild(child, title) {
        open(deps.host.getState().hold({ child }, BY), title)
      },

      async close(key) {
        if (!find(key)) return
        remove(key)
        await deps.host.getState().release(key, BY)
      },

      raise(key) {
        const p = find(key)
        if (!p || get().popups.at(-1) === p) return
        set((s) => ({ popups: [...s.popups.filter((x) => x !== p), p] }))
      },

      place(key, b) {
        set((s) => ({ popups: s.popups.map((p) => (p.key === key ? { ...p, bounds: clampBounds(b, deps.viewport()) } : p)) }))
      },
    }
  })
}
