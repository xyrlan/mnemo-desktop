import { useEffect, useRef, useState } from 'react'
import { store as appStore } from '../layout/app-store'
import type { Mission, Pr } from '../mission/types'

/** What the inbox rows and the mission map run. Commands go to a terminal tab in the repo,
 *  so their output stays in front of the user; pages open in a browser pane. */

/** The PR's checks page: GitHub lists the failing job first there. */
export function openJob(pr: Pr) {
  appStore.getState().openView('browser', { url: `${pr.url.replace(/\/+$/, '')}/checks` }, 'auto', `PR #${pr.number} checks`)
}

export const mergeCmd = (pr: Pr) => `gh pr merge ${pr.number} --squash`
export const landCmd = (m: Mission) => `mnemo land ${m.contract_path} --merge`

export function mergePr(root: string, pr: Pr) {
  void appStore.getState().openCommandTab(root, mergeCmd(pr))
}

export function landMission(root: string, m: Mission) {
  void appStore.getState().openCommandTab(root, landCmd(m))
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
