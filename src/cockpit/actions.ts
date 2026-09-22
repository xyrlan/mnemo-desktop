import { useEffect, useRef, useState } from 'react'
import { store as appStore } from '../layout/app-store'
import type { Mission, Pr } from '../mission/types'
import { runJob } from './job'
import { mergeChecked } from './merge'

export { mergeArgv, mergeKey, mergePlan } from './merge'

/** What the inbox rows and the mission map run. Pages open in a browser pane. `merge` and
 *  `land` run headless: the user already confirmed them twice (`useArm`), so they do not move
 *  anyone to a terminal to watch — the row says how it went, and the log is in its drawer.
 *  A merge is gated on the PR's checks at the moment it runs (`merge.ts`). */

/** The PR's checks page: GitHub lists the failing job first there. */
export function openJob(pr: Pr) {
  appStore.getState().openView('browser', { url: `${pr.url.replace(/\/+$/, '')}/checks` }, 'auto', `PR #${pr.number} checks`)
}

export const landArgv = (m: Mission) => ['mnemo', 'land', m.contract_path, '--merge']

/** A land's job key is its row's key (`needs.ts`), as a merge's is (`mergeKey`). */
export const landKey = (m: Mission) => `land:${m.contract_path}`

/** Merges `pr` only if every one of its checks passed when the merge runs, marking a draft
 *  ready first; the row keyed `mergeKey(root, pr)` says how it went. The PR view calls it too. */
export function mergePr(root: string, pr: Pr) {
  void mergeChecked(root, pr)
}

export function landMission(root: string, m: Mission) {
  void runJob(landKey(m), `land · ${m.feature}`, root, landArgv(m))
}

/** Hands a job's log to a pane of its own, for whoever wants the full screen. It shows the same
 *  log, still streaming; it never runs anything again. */
export function openJobLog(key: string, title: string) {
  appStore.getState().openView('job-log', { job: key }, 'auto', title)
}

export function stopChild(id: string) {
  appStore.getState().openView('terminal-cmd', { cmd: `claude stop ${id}` }, 'split-col', `stop ${id}`)
}

/** Two-step confirmation for what cannot be undone (merge, land, stop): the first `fire(key)`
 *  arms `key` and returns false, a second one within `ms` returns true. `armed` names what
 *  is waiting for the second press, so the button can say so. */
export function useArm(ms = 4000): { armed: string | null; fire: (key: string) => boolean } {
  const [armed, setArmed] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const fire = (key: string) => {
    window.clearTimeout(timer.current)
    if (armed === key) {
      setArmed(null)
      return true
    }
    setArmed(key)
    timer.current = window.setTimeout(() => setArmed(null), ms)
    return false
  }
  return { armed, fire }
}
