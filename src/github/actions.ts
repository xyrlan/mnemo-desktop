import { cockpitStore } from '../cockpit/app-store'
import { runJob } from '../cockpit/job'
import { nexusRoutes } from '../nexus/outside'

/** What a click does with GitHub: a dispatch runs headless with `runJob`, its output captured
 *  and shown in its job's log rather than typed into a fresh terminal; a page opens in the system
 *  browser (`nexus/outside`). */

type DispatchOpts = { model?: string; effort?: string; may?: string }

const flagWords = (opts?: DispatchOpts) => {
  const words: string[] = []
  if (opts?.model) words.push('--model', opts.model)
  if (opts?.effort) words.push('--effort', opts.effort)
  if (opts?.may) words.push('--may', opts.may)
  return words
}

/** Runs `argv` in `root` as `key`'s job, then opens its drawer: unlike a merge or a land, a
 *  dispatch is not silent on success — `mnemo dispatch` prints each child's id, branch, `queue:`
 *  and `attach:` lines, and a rejected contract refuses before any worktree exists. The maintainer
 *  needs to see that whether it succeeds or fails. */
function runDispatch(key: string, title: string, root: string, argv: string[]) {
  void runJob(key, title, root, argv)
  cockpitStore.getState().openDrawer(key)
}

export function dispatchIssue(root: string, n: number) {
  dispatchIssues(root, [n])
}

export const dispatchKey = (root: string, ns: number[]) => `dispatch:${root}#${ns.join(',')}`

/** Dispatches every issue in `ns` together: `mnemo dispatch <n> <n> ... [--model x] [--effort x]
 *  [--may x]`, run headless and captured rather than typed into a terminal. */
export function dispatchIssues(root: string, ns: number[], opts?: DispatchOpts) {
  if (!ns.length) return
  const argv = ['mnemo', 'dispatch', ...ns.map(String), ...flagWords(opts)]
  runDispatch(dispatchKey(root, ns), `dispatch · ${ns.map((n) => `#${n}`).join(', ')}`, root, argv)
}

export const contractDispatchKey = (root: string, path: string) => `dispatch:${root}#contract:${path}`

/** Dispatches every piece of a decomposition contract at `path` (repo-relative):
 *  `mnemo dispatch --contract <path> [--model x] [--effort x] [--may x]`. A contract the parser
 *  rejects is refused before any worktree exists; the refusal shows in the job's drawer like
 *  any other line it prints. */
export function dispatchContract(root: string, path: string, opts?: DispatchOpts) {
  const argv = ['mnemo', 'dispatch', '--contract', path, ...flagWords(opts)]
  runDispatch(contractDispatchKey(root, path), `dispatch · contract ${path}`, root, argv)
}

export const resumeKey = (root: string) => `resume:${root}`

/** Wakes every child in `root` the account's rate limit stopped, once its reset has passed:
 *  `mnemo resume`. */
export function resumeChildren(root: string) {
  runDispatch(resumeKey(root), `resume · ${root}`, root, ['mnemo', 'resume'])
}

/** Opens `url` in the system browser. */
export function openUrl(url: string) {
  void nexusRoutes()
    .page(url)
    .catch(() => {})
}
