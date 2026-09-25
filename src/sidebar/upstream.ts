/** Everything the left sidebar reads from the rest of the app, in one seam so its tests mock a
 *  single module: the fleet (repos, worktrees, agents), the mission snapshot (which child is in
 *  which wave), the layout (which worktree is shown),
 *  Home (adding and forgetting a project), the worktrees' backend, the action registry, the
 *  shell and its toasts. */
import { homeStore } from '../home/app-store'

export { fleetStore, useFleet } from '../fleet/store'
export { missionStore } from '../mission/app-store'
export { store as layoutStore } from '../layout/app-store'
export { homeStore }
export { register, run } from '../actions/registry'
export { mountInSlot } from '../shell/slots'
export { useShell } from '../shell/store'
export { cleanupFacts, listWorktrees, removeWorktree } from '../worktrees/client'
export { toast } from '@/ui'

/** Takes `root` off the user's project list: Home's `forgetProject`, from the wave-C
 *  `projects-persist` piece. The cast keeps this building before that piece lands; after, it is
 *  the same call. */
export const forgetProject = (root: string): Promise<void> =>
  (homeStore.getState() as unknown as { forgetProject(root: string): Promise<void> }).forgetProject(root)
