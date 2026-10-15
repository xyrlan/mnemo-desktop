import type { ActionResult, Ship, ShipAction } from '../ship-types'

/** Does what an action says, with the app's own paths (spec "Acting from it"). Stub until the
 *  `command` piece lands. */
export async function runAction(action: ShipAction, _ship: Ship): Promise<ActionResult> {
  return { ok: false, say: `${action.kind}: not built yet`, log: [] }
}
