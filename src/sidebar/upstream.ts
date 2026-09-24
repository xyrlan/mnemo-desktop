/** Everything the left sidebar reads from the rest of the app, in one seam so its tests mock a
 *  single module: the fleet (repos, worktrees, agents), the layout (which worktree is shown),
 *  Home's client (adding a project), the action registry, and the shell. */

export { fleetStore, useFleet } from '../fleet/store'
export { store as layoutStore } from '../layout/app-store'
export { homeStore } from '../home/app-store'
export { register, run } from '../actions/registry'
export { mountInSlot, useShell } from './shell'
