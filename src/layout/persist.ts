import { invoke } from '@tauri-apps/api/core'
import type { Store } from './store'

export interface WorkspaceClient {
  read(): Promise<unknown>
  write(value: unknown): Promise<void>
}

export const tauriWorkspace: WorkspaceClient = {
  read: () => invoke<unknown>('workspace_read'),
  write: (value) => invoke('workspace_write', { value }),
}

/** How long the layout has to stay still before it is written. */
export const SAVE_DEBOUNCE_MS = 500

export type Workspace = {
  /** Settles once the saved layout is back (or could not be): `notice` is the one line Home
   *  shows when the restore failed. Saving starts only then, so a boot never overwrites the
   *  file with an empty layout; after a failed restore it never starts, so the file that could
   *  not be read is still there to mend. */
  ready: Promise<{ notice: string | null }>
  stop(): void
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Restores `~/.mnemo-desktop/workspace.json` into the store, then writes it back on every layout
 *  change (a switch of worktree included), debounced. Writes only when what would be saved differs from the last write.
 *  `onSaveError` hears a write that failed, once until a write succeeds again. */
export function startWorkspace(
  store: Store,
  client: WorkspaceClient = tauriWorkspace,
  debounceMs = SAVE_DEBOUNCE_MS,
  onSaveError: (why: string) => void = () => {},
): Workspace {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let last = ''
  let failing = false
  let unsubscribe = () => {}

  const save = () => {
    timer = undefined
    const value = store.getState().snapshotForSave()
    const text = JSON.stringify(value)
    if (text === last) return
    last = text
    // A failed write is retried by the next change, and said once.
    client.write(value).then(
      () => {
        failing = false
      },
      (e) => {
        last = ''
        if (!failing) onSaveError(message(e))
        failing = true
      },
    )
  }

  const ready = (async () => {
    try {
      await store.getState().restore(await client.read())
    } catch (e) {
      // Whatever the file holds was not restored, so nothing of this run goes over it.
      return { notice: `could not restore the last workspace (left as it is, this run's layout is not saved): ${message(e)}` }
    }
    if (stopped) return { notice: null }
    // What is on screen now is what the file says (or should say): no write until it changes.
    last = JSON.stringify(store.getState().snapshotForSave())
    unsubscribe = store.subscribe((s, prev) => {
      const same = s.tabs === prev.tabs && s.panes === prev.panes && s.activeTab === prev.activeTab
      const groups = s.groups === prev.groups && s.groupRoot === prev.groupRoot && s.activeGroup === prev.activeGroup
      if (same && groups && s.activeWorktree === prev.activeWorktree && s.worktrees === prev.worktrees && s.parked === prev.parked) return
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(save, debounceMs)
    })
    return { notice: null }
  })()

  return {
    ready,
    stop() {
      stopped = true
      unsubscribe()
      if (timer !== undefined) clearTimeout(timer)
    },
  }
}
