import type { State } from '../layout/store'
import { leaves } from '../layout/tree'

/** Where `gh pr view` should run: the focused pane's cwd when it is a terminal, otherwise
 *  the first terminal in the active tab that has reported one (OSC 7). */
export function terminalCwd(s: Pick<State, 'tabs' | 'activeTab' | 'panes'>): string | undefined {
  const tab = s.tabs.find((t) => t.id === s.activeTab)
  if (!tab) return undefined
  const order = [tab.focused, ...leaves(tab.root).filter((p) => p !== tab.focused)]
  for (const id of order) {
    const pane = s.panes[id]
    if (pane?.view === 'terminal' && pane.cwd) return pane.cwd
  }
  return undefined
}
