import type { State } from './store'
import { store } from './app-store'
import { focusedCwd } from '../mission/scope'
import { missionStore } from '../mission/app-store'
import type { Snapshot } from '../mission/types'
import { homeStore } from '../home/app-store'

/** Where ⌘D / ⌘T start a shell: the focused pane's directory in the active tab (see
 *  `focusedCwd`), else on Home the selected repo's root. `undefined` lets the core start it
 *  in the home directory. Defaults read the live stores; tests pass their own. */
export function cwdForNewShell(
  layout: Pick<State, 'tabs' | 'activeTab' | 'panes'> = store.getState(),
  snapshot: Snapshot = missionStore.getState().snapshot,
  homeSelected: string | null = homeStore.getState().selected,
): string | undefined {
  if (layout.activeTab === '') return homeSelected ?? undefined
  return focusedCwd(layout, snapshot)
}
