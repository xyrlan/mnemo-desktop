import type { State, Store } from '../layout/store'
import { leaves, type PaneId } from '../layout/tree'
import { groupOf } from '../layout/groups'

/** Where the Dispatch tab goes (spec decision 4): one per parent workspace, "to the side" of the
 *  terminal of the session that dispatched it. */

/** The pane view the tab registers (`view.tsx`). */
export const VIEW = 'dispatch'

const norm = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p)

/** The Dispatch tab of `parent` in the shown worktree: its pane and its tab. */
export function dispatchPane(s: Pick<State, 'tabs' | 'panes'>, parent: string): { pane: PaneId; tab: string } | null {
  const want = norm(parent)
  for (const t of s.tabs) {
    for (const id of leaves(t.root)) {
      const p = s.panes[id]
      if (p?.view === VIEW && norm(String(p.props?.parent ?? '')) === want) return { pane: id, tab: t.id }
    }
  }
  return null
}

/** Shows `parent`'s Dispatch tab, which the shown worktree must be (else nothing happens and it
 *  answers null). With none open, one opens in the group to the right of `beside`'s (the parent's
 *  terminal), else of the active group, made when there is none.
 *
 *  `focus`: it becomes the tab you are in (a click asked for it). Without, what you are in stays
 *  so, keys and all (the tab opened by itself); an open tab is only brought up in its own group,
 *  and not even that when it shares yours, since it would cover what you look at. */
export function placeDispatch(layout: Store, parent: string, opts: { beside?: PaneId | null; focus: boolean }): PaneId | null {
  const s = layout.getState()
  if (s.activeWorktree === null || norm(s.activeWorktree) !== norm(parent)) return null
  const was = { activeGroup: s.activeGroup, activeTab: s.activeTab }
  const keep = () => {
    if (!opts.focus && was.activeGroup && layout.getState().groups[was.activeGroup]) layout.setState(was)
  }

  const open = dispatchPane(s, parent)
  if (open) {
    if (opts.focus) s.goToPane(open.pane)
    else if (groupOf(s, open.tab) !== s.activeGroup) {
      s.activateTab(open.tab)
      keep()
    }
    return open.pane
  }

  const anchor = opts.beside == null ? undefined : s.tabs.find((t) => leaves(t.root).includes(opts.beside!))
  const group = anchor && groupOf(s, anchor.id)
  // "To the side" is to the side of the active group: the terminal's group is made so for a moment.
  if (group !== undefined && group !== s.activeGroup) s.focusGroup(group)
  layout.getState().openView(VIEW, { parent: norm(parent) }, 'split-row', 'Dispatch')
  keep()
  return dispatchPane(layout.getState(), parent)?.pane ?? null
}
