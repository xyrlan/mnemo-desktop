import type { PulseEvent } from '../pulse/types'
import type { Packet, Target, World } from './types'

export type SceneProps = {
  world: World
  packets: Packet[]
  /** The recent pulse events, for the hover card. */
  events: PulseEvent[]
  /** A click on a nexus, robot or archive. */
  onPick(target: Target): void
  /** `prefers-reduced-motion`: no travel and no loops; counters and halos only. */
  reducedMotion: boolean
  /** False while the window is hidden: animations pause. */
  visible: boolean
}

/** The world drawn (spec Q4, Q11, Q16–Q18, Q21–Q23): territories in a grid that fits the drawer,
 *  robots in a ring round their nexus, the archive per territory and the universal core.
 *
 *  Stub until the `scene` piece lands: the territories by name. */
export function Scene({ world }: SceneProps) {
  return (
    <ul className="p-4 text-sm text-muted-foreground">
      {world.territories.map((t) => (
        <li key={t.root}>{t.name}</li>
      ))}
    </ul>
  )
}
