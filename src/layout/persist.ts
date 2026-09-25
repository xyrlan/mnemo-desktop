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
   *  file with an empty layout. */
  ready: Promise<{ notice: string | null }>
  stop(): void
}

/** Restores `~/.mnemo-desktop/workspace.json` into the store, then writes it back on every layout
 *  change (a switch of worktree included), debounced. Writes only when what would be saved differs from the last write. */
export function startWorkspace(store: Store, client: WorkspaceClient = tauriWorkspace, debounceMs = SAVE_DEBOUNCE_MS): Workspace {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let last = ''
  let unsubscribe = () => {}

  const save = () => {
    timer = undefined
    const value = store.getState().snapshotForSave()
    const text = JSON.stringify(value)
    if (text === last) return
    last = text
    // The file is a convenience: a failed write is retried by the next change.
    void client.write(value).catch(() => {
      last = ''
    })
  }

  const ready = (async () => {
    let notice: string | null = null
    try {
      await store.getState().restore(await client.read())
    } catch (e) {
      notice = `could not restore the last workspace: ${e instanceof Error ? e.message : String(e)}`
    }
    if (stopped) return { notice }
    // What is on screen now is what the file says (or should say): no write until it changes.
    last = JSON.stringify(store.getState().snapshotForSave())
    unsubscribe = store.subscribe((s, prev) => {
      const same = s.tabs === prev.tabs && s.panes === prev.panes && s.activeTab === prev.activeTab
      const groups = s.groups === prev.groups && s.groupRoot === prev.groupRoot && s.activeGroup === prev.activeGroup
      if (same && groups && s.activeWorktree === prev.activeWorktree && s.worktrees === prev.worktrees && s.parked === prev.parked) return
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(save, debounceMs)
    })
    return { notice }
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
