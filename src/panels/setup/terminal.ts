import { nexusRoutes } from '../../nexus/outside'

/** Runs `command` in a terminal the app shows, started in the home folder: an installer, a
 *  sign-in. `label` names it. It goes through the app's own route for a terminal asked from
 *  anywhere (`nexus/outside.ts`), which whoever hosts terminals sets; until one is set the
 *  promise rejects with why, and the panel says it in place. */
export const inTerminal = (command: string, label: string): Promise<void> => nexusRoutes().terminal(undefined, command, label)
