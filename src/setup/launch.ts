import type { Place, Store } from '../layout/store'
import { leaves } from '../layout/tree'
import { needsSetup, type ToolStatus } from './tools'

/** How long to wait for the app to start restoring the saved workspace before giving up on it:
 *  when the file cannot be read, `restore` is never called. */
export const RESTORE_WAIT_MS = 3000

/** Settles once the saved workspace is back in `store`. The restore sets the active tab when it
 *  ends, so a tab opened before that would be pushed behind the restored ones. `App` starts the
 *  restore and keeps its promise to itself, so this waits on the store's own `restore` instead.
 *  Resolves after `waitMs` if `restore` is never called. */
export function afterRestore(store: Store, waitMs = RESTORE_WAIT_MS): Promise<void> {
  return new Promise((resolve) => {
    const restore = store.getState().restore
    const timer = setTimeout(done, waitMs)
    function done() {
      clearTimeout(timer)
      if (store.getState().restore === wrapped) store.setState({ restore })
      resolve()
    }
    // Once the restore has started it may take as long as its terminals take to spawn.
    const wrapped: typeof restore = async (saved) => {
      clearTimeout(timer)
      try {
        await restore(saved)
      } finally {
        done()
      }
    }
    store.setState({ restore: wrapped })
  })
}

/** Shows the setup pane: the one already open, wherever it is, or a new one at `place`. */
export function showSetup(store: Store, place: Place) {
  const s = store.getState()
  const open = s.tabs.flatMap((t) => leaves(t.root)).find((p) => s.panes[p]?.view === 'setup')
  if (open !== undefined) return s.goToPane(open)
  s.openView('setup', {}, place, 'setup')
}

/** The launch check: once the workspace is back, opens setup when `claude` or `mnemo` is
 *  missing. Resolves with whether it opened it. */
export async function openIfMissing(deps: { restored: Promise<unknown>; check: () => Promise<ToolStatus[] | null>; open: () => void }) {
  const [rows] = await Promise.all([deps.check(), deps.restored])
  if (!rows || !needsSetup(rows)) return false
  deps.open()
  return true
}
