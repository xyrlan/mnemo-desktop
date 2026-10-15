import { store as layout } from '../layout/app-store'
import { sessionTitle } from '../layout/tabs'
import { missionStore } from '../mission/app-store'
import { homeStore } from '../home/app-store'
import { startMissionPoll } from './mission-poll'
import { startTitleReload } from './title-reload'
import { pollWhileShown } from './while-shown'

/** The app's background work, wired to its stores. The logic lives beside, in modules tests
 *  drive without Tauri. */

export const pollMission = () =>
  startMissionPoll({
    // Every repo: the Nexus shows the whole fleet, with no folder in focus.
    refresh: (withPrs) => missionStore.getState().refresh(undefined, withPrs),
    loadLooked: () => missionStore.getState().loadLooked(),
    hidden: () => document.hidden,
  })

export const reloadUnknownTitles = () =>
  startTitleReload({
    unknown: () => {
      const home = homeStore.getState().snapshot
      return Object.values(layout.getState().panes).some((p) => !!p.sessionId && !sessionTitle(home, p.sessionId))
    },
    loading: () => homeStore.getState().loading,
    load: () => homeStore.getState().load(),
    onChange(cb) {
      const offs = [
        layout.subscribe((s, p) => void (s.panes !== p.panes && cb())),
        homeStore.subscribe((s, p) => void (s.snapshot !== p.snapshot && cb())),
      ]
      return () => offs.forEach((off) => off())
    },
  })

/** GitHub's issues and PRs, which the MISSIONS window and the fleet's PR badges read: once at
 *  launch, then every five minutes. */
export function refreshGithubEvery(ms = 5 * 60_000): () => void {
  const refresh = () => void homeStore.getState().refreshGithub()
  void homeStore
    .getState()
    .load()
    .then(refresh)
  // Not while the window is hidden: what it feeds is not on screen.
  return pollWhileShown(refresh, ms, { wait: true })
}
