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

/** "Open pull request for this branch": the PR opens, or the person is told which reason kept
 *  it from opening (`browser_pr_url` names it: `gh` missing, not logged in, offline, no PR). */
export async function openBranchPr(d: { prUrl(cwd?: string): Promise<string>; cwd: string | undefined; open(url: string): void; tell(why: string): void }): Promise<void> {
  let url: string
  try {
    url = await d.prUrl(d.cwd)
  } catch (e) {
    d.tell(e instanceof Error ? e.message : String(e))
    return
  }
  d.open(url)
}
