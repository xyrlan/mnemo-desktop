import { useEffect, useRef, useState } from 'react'
import { store as appStore } from '../layout/app-store'
import type { Pr } from '../mission/types'
import { mergeChecked } from './merge'

export { mergeKey } from './merge'

/** What the PR view's merge runs (`src/home/review/Merge.tsx`). A merge runs headless: the user
 *  already confirmed it twice (`useArm`), so nobody is moved to a terminal to watch — the view
 *  says how it went, and the log opens in a pane. It is gated on the PR's checks at the moment it
 *  runs (`merge.ts`). */

/** Merges `pr` only if every one of its checks passed when the merge runs, marking a draft
 *  ready first; the job keyed `mergeKey(root, pr)` says how it went. */
export function mergePr(root: string, pr: Pr) {
  void mergeChecked(root, pr)
}

/** Hands a job's log to a pane of its own, for whoever wants the full screen. It shows the same
 *  log, still streaming; it never runs anything again. */
export function openJobLog(key: string, title: string) {
  appStore.getState().openView('job-log', { job: key }, 'auto', title)
}

/** Two-step confirmation for what cannot be undone (a merge): the first `fire(key)`
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
