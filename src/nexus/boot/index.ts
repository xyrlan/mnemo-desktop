import { learned, learnedClient } from '../../learned/app-store'
import { settled } from '../../learned/store'
import { fleetStore } from '../../fleet/store'
import { homeStore } from '../../home/app-store'
import { settingsStore } from '../../settings/app-store'
import { setup } from '../../setup/app-store'
import { afterStartup } from '../../shell/after-startup'
import { mountInSlot } from '../../shell/slots'
import { knownRepos } from '../repos'
import { windowStore } from '../ui/windows'
import { chooseRepo } from '../windows/memory/repo'
import { firstRun } from './first-run'
import { showNexusWindow } from './show'
import { NexusToasts } from './Toasts'

export { firstRun, type FirstRunDeps } from './first-run'
export { NexusToasts } from './Toasts'
export { showNexusWindow } from './show'

/** Every repo the Nexus knows, as its windows list them (`knownRepos`): the fleet's first. */
const knownRoots = () => knownRepos(fleetStore.getState().repos, homeStore.getState().snapshot.repos, settingsStore.getState().projects).map((r) => r.root)

/** What the app needs at launch, owned by the Nexus:
 *  - the **settings** are read, so `skipPermissions`, `quickCommands` and the rest hold from the
 *    start (`load` once per run: a second start reads nothing again);
 *  - the **toaster**, in the overlay slot: every `toast(...)` lands in it;
 *  - the **first run**: Setup when `claude` or `mnemo` is missing, then What mnemo learned
 *    (`firstRun`).
 *  Returns the stop: the toaster comes out and nothing more opens. Each call is counted, so a
 *  second start (StrictMode's double effect, two callers while 2b moves the call) runs nothing
 *  twice and only the last stop stops it. */
export function startNexusApp(): () => void {
  if (!running) running = { count: 0, stop: start() }
  running.count++
  let stopped = false
  return () => {
    if (stopped || !running) return
    stopped = true
    if (--running.count > 0) return
    running.stop()
    running = null
  }
}

let running: { count: number; stop: () => void } | null = null
let settingsRead = false

function start(): () => void {
  if (!settingsRead && !settingsStore.getState().loaded) void settingsStore.getState().load()
  settingsRead = true
  const unmount = mountInSlot('overlay', NexusToasts)
  const stopFirstRun = firstRun({
    // After the launch's first burst: it is four `--version` runs nobody waits on.
    checkTools: () => afterStartup().then(() => setup.getState().check()),
    toolRows: () => setup.getState().rows,
    subscribeTools: (fn) => setup.subscribe(fn),
    review: {
      client: learnedClient,
      cwds: knownRoots,
      subscribe: (fn) => {
        const stops = [fleetStore.subscribe(fn), homeStore.subscribe(fn), settingsStore.subscribe(fn)]
        return () => stops.forEach((s) => s())
      },
    },
    ask: (target, dry) => {
      if (!settled(learned.getState().phase)) return false
      learned.getState().ask(target, dry)
      // The window reads for the repo it asks about.
      chooseRepo(target.root)
      return true
    },
    stillAsking: () => learned.getState().phase.kind === 'consent',
    openWindowId: () => windowStore.getState().open?.id ?? null,
    subscribeWindow: (fn) => windowStore.subscribe(fn),
    open: showNexusWindow,
  })
  return () => {
    stopFirstRun()
    unmount()
  }
}
