import { store as appStore } from '../layout/app-store'
import { missionStore } from '../mission/app-store'
import { focusedCwd } from '../mission/scope'

/** Where you were last working: the focused cwd of the last active tab that had one. The
 *  cockpit often opens in a tab of its own, where no pane says which repo `este repo` means;
 *  then it is the one you just left. Tracked from import, so it knows before the cockpit opens. */
let last: string | undefined

const track = () => {
  const s = appStore.getState()
  const cwd = focusedCwd(s, missionStore.getState().snapshot)
  if (cwd) last = cwd
}
track()
appStore.subscribe(track)

export const lastCwd = () => last
