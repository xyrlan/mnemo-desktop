import type { State } from '../layout/store'
import { leaves } from '../layout/tree'

const dirname = (p: string) => p.replace(/\/+[^/]*$/, '') || '/'

/** Where `mnemo import` runs, which decides the project the rules are staged for:
 *  a terminal's cwd in the active tab (the focused pane first), else the tree root of
 *  an editor there, else any terminal that reported a cwd. The marketplace pane itself
 *  is usually the focused one when Import is clicked, hence the walk. */
export function importCwd(s: Pick<State, 'tabs' | 'activeTab' | 'panes'>): string | undefined {
  const tab = s.tabs.find((t) => t.id === s.activeTab)
  const order = tab ? [tab.focused, ...leaves(tab.root).filter((p) => p !== tab.focused)] : []
  for (const id of order) {
    const pane = s.panes[id]
    if (pane?.view === 'terminal' && pane.cwd) return pane.cwd
  }
  for (const id of order) {
    const pane = s.panes[id]
    if (pane?.view !== 'editor') continue
    const { root, path } = pane.props ?? {}
    if (typeof root === 'string' && root) return root
    if (typeof path === 'string' && path.startsWith('/')) return dirname(path)
  }
  return Object.values(s.panes).find((p) => p.view === 'terminal' && p.cwd)?.cwd
}
