import { store as layout } from '../layout/app-store'
import { sessionTitle } from '../layout/tabs'
import { missionStore } from '../mission/app-store'
import { focusedCwd } from '../mission/scope'
import { homeStore } from '../home/app-store'
import { fleetStore } from '../fleet/store'
import { startMissionPoll } from './mission-poll'
import { keepAWorktreeShown } from './first-worktree'
import { startTitleReload } from './title-reload'

/** The shell's background work, wired to the app's stores. The logic lives beside, in modules
 *  tests drive without Tauri. */

export const pollMission = () =>
  startMissionPoll({
    // Scoped to the focused pane's folder, else to the worktree shown when it has no tab open.
    refresh: (withPrs) =>
      missionStore.getState().refresh(focusedCwd(layout.getState(), missionStore.getState().snapshot) ?? layout.getState().activeWorktree ?? undefined, withPrs),
    loadLooked: () => missionStore.getState().loadLooked(),
    hidden: () => document.hidden,
  })

export const showFirstWorktree = () =>
  keepAWorktreeShown({
    shown: () => layout.getState().activeWorktree,
    repos: () => fleetStore.getState().repos,
    switchTo: (path) => void layout.getState().switchWorktree(path),
    onChange(cb) {
      const offs = [
        fleetStore.subscribe((s, p) => void (s.repos !== p.repos && cb())),
        layout.subscribe((s, p) => void (s.activeWorktree !== p.activeWorktree && cb())),
      ]
      return () => offs.forEach((off) => off())
    },
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

/** Home fetched GitHub's issues and PRs when it showed. With Home gone, the fleet's PR badges
 *  and Tasks read them from here: once at launch, then every five minutes. */
export function refreshGithubEvery(ms = 5 * 60_000): () => void {
  const refresh = () => void homeStore.getState().refreshGithub()
  void homeStore
    .getState()
    .load()
    .then(refresh)
  const timer = setInterval(refresh, ms)
  return () => clearInterval(timer)
}
