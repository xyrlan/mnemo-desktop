import { registerPaneView } from '../panes/registry'
import { register } from '../actions/registry'
import { store } from '../layout/app-store'
import { leaves } from '../layout/tree'
import Tasks from './Tasks'

registerPaneView('tasks', Tasks)

/** Tasks is one pane: opening it again goes to the one already open, in whichever worktree holds
 *  it, rather than stacking copies. */
export function openTasks() {
  const st = store.getState()
  const tabs = [st.tabs, ...Object.values(st.parked).map((l) => l.tabs)].flat()
  const open = Object.values(st.panes).find((p) => p.view === 'tasks' && tabs.some((t) => leaves(t.root).includes(p.id)))
  if (open) st.goToPane(open.id)
  else st.openView('tasks', {}, 'tab', 'Tasks')
}

register({ id: 'tasks.open', title: 'Tasks (issues and pull requests)', run: openTasks })
