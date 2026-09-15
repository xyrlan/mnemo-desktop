import { store as layout } from '../layout/app-store'
import { settingsStore } from '../settings/app-store'
import { githubStore } from './app-store'
import { SCOPE_FIX, type Issue } from './types'

/** What a click does with GitHub: commands run in a terminal tab, pages open in a browser pane. */

export function dispatchIssue(root: string, n: number) {
  void layout.getState().openCommandTab(root, `mnemo dispatch ${n}`)
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
