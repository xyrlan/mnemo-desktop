import { createStore as createZustand, type StoreApi } from 'zustand/vanilla'
import type { SetupClient } from './client'
import type { ToolStatus } from './tools'

/** One button's run: `lines` is what it printed while running, `ok` its sentence on success,
 *  `error` what failed. */
export type Run = { running: boolean; lines: string[]; ok: string | null; error: string | null }

export const IDLE_RUN: Run = { running: false, lines: [], ok: null, error: null }

export type SetupState = {
  /** The last `tools_status` answer; null until one arrives. */
  rows: ToolStatus[] | null
  checking: boolean
  /** Why the last check failed. */
  statusError: string | null
  mnemo: Run
  path: Run
}

export type SetupActions = {
  /** Asks `tools_status` again. Resolves with the rows, or null when the check failed. */
  check(): Promise<ToolStatus[] | null>
  /** Installs mnemo, collecting its `tools-install` lines; checks again once it is in place. */
  installMnemo(): Promise<void>
  addToPath(): Promise<void>
}

export type SetupStore = StoreApi<SetupState & SetupActions>

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function createSetupStore(client: SetupClient): SetupStore {
  return createZustand<SetupState & SetupActions>((set, get) => {
    // Only the newest check lands: one asked after an install must not be overwritten by an
    // older one that was still running when it finished.
    let asked = 0

    return {
      rows: null,
      checking: false,
      statusError: null,
      mnemo: IDLE_RUN,
      path: IDLE_RUN,

      async check() {
        const mine = ++asked
        set({ checking: true })
        try {
          const rows = await client.status()
          if (!Array.isArray(rows)) throw new Error('tools_status answered with no list of tools')
          if (mine === asked) set({ rows, checking: false, statusError: null })
          return rows
        } catch (e) {
          if (mine === asked) set({ checking: false, statusError: message(e) })
          return null
        }
      },

      async installMnemo() {
        if (get().mnemo.running) return
        set({ mnemo: { ...IDLE_RUN, running: true } })
        const line = (text: string) => set((s) => ({ mnemo: { ...s.mnemo, lines: [...s.mnemo.lines, text] } }))
        // Listening first: the download's first line can arrive before `invoke` returns anything.
        const stop = await client
          .onInstallLine((l) => l.tool === 'mnemo' && line(l.message))
          .catch(() => () => {})
        try {
          const tag = await client.installMnemo()
          set((s) => ({ mnemo: { ...s.mnemo, running: false, ok: `mnemo ${tag} installed` } }))
          await get().check()
        } catch (e) {
          set((s) => ({ mnemo: { ...s.mnemo, running: false, error: message(e) } }))
        } finally {
          stop()
        }
      },

      async addToPath() {
        if (get().path.running) return
        set({ path: { ...IDLE_RUN, running: true } })
        try {
          const said = await client.addToPath()
          set({ path: { ...IDLE_RUN, ok: said } })
        } catch (e) {
          set({ path: { ...IDLE_RUN, error: message(e) } })
        }
      },
    }
  })
}
