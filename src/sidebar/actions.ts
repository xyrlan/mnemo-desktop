import { fleetStore, homeStore, layoutStore, register } from './upstream'
import { sidebarStore } from './store'
import { sidebarOrder } from './model'

/** Show worktree `path` and mark it read: what a card click does. */
export function activateWorktree(path: string) {
  void layoutStore.getState().switchWorktree(path)
  fleetStore.getState().markRead(path)
}

/** Show the pane an agent runs in (its worktree comes with it), or, for an agent with no pane on
 *  screen (a dispatched child), its worktree. */
export function activateAgent(worktree: string, paneId: number | null) {
  if (paneId === null) return activateWorktree(worktree)
  layoutStore.getState().goToPane(paneId)
  fleetStore.getState().markRead(worktree)
}

/** "Add project": Home's folder picker and registration. Resolves to the error Home reported, if
 *  this pick caused one, so the sidebar can say it where the click was. */
export async function addProject(): Promise<string | null> {
  const before = homeStore.getState().notice
  await homeStore.getState().openFolder()
  const after = homeStore.getState().notice
  if (after === null || after === before) return null
  homeStore.getState().dismiss()
  return after
}

/** `worktree.go.1` … `worktree.go.9`: the Nth card in sidebar order, folded repos left out. */
export function registerSidebarActions() {
  for (let n = 1; n <= 9; n++) {
    register({
      id: `worktree.go.${n}`,
      title: `Go to workspace ${n}`,
      shortcut: `⌘${n}`,
      run: () => {
        const w = sidebarOrder(fleetStore.getState().repos, sidebarStore.getState().collapsed)[n - 1]
        if (w) activateWorktree(w.path)
      },
    })
  }
}
