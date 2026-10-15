import type { JSX } from 'react'
import type { ShipSceneProps } from './ship-types'

/** The ship drawn (spec "What it is"). Stub until the `scene` piece lands: it shows the bridge's
 *  slot, so the fleet prompt is reachable while the rest is built. */
export function ShipScene({ bridge }: ShipSceneProps): JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-ship-scene="">
      {bridge}
    </div>
  )
}
