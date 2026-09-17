import { store as layout } from '../layout/app-store'
import { settingsStore } from '../settings/app-store'
import { githubStore } from './app-store'
import { SCOPE_FIX, type Issue } from './types'

/** What a click does with GitHub: commands run in a terminal tab, pages open in a browser pane. */

export function dispatchIssue(root: string, n: number) {
  dispatchIssues(root, [n])
}

/** Dispatches every issue in `ns` together: `mnemo dispatch <n> <n> ... [--model x] [--effort x] [--may x]`,
 *  typed into a fresh terminal tab the same way the single-issue path already does. */
export function dispatchIssues(root: string, ns: number[], opts?: { model?: string; effort?: string; may?: string }) {
  if (!ns.length) return
  const words = ['mnemo', 'dispatch', ...ns.map(String)]
  if (opts?.model) words.push('--model', opts.model)
  if (opts?.effort) words.push('--effort', opts.effort)
  if (opts?.may) words.push('--may', opts.may)
  void layout.getState().openCommandTab(root, words.join(' '))
}

export function openUrl(url: string, title: string) {
  layout.getState().openView('browser', { url }, 'auto', title)
}

export const openIssue = (i: Pick<Issue, 'number' | 'url'>) => openUrl(i.url, `#${i.number}`)

export function ghLogin() {
  void layout.getState().openCommandTab(undefined, 'gh auth login --web')
  githubStore.getState().watchLogin()
}

export const installGh = () => void layout.getState().openCommandTab(undefined, 'brew install gh')

export const refreshScope = () => void layout.getState().openCommandTab(undefined, SCOPE_FIX)

export function setIssueLabels(root: string, labels: string[]) {
  const all = { ...settingsStore.getState().issueLabels }
  if (labels.length) all[root] = labels
  else delete all[root]
  void settingsStore.getState().set('issueLabels', all)
}
