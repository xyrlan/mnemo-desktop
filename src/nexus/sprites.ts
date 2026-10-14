import { ACCESSORIES, type NexusPose, type RobotClass, type RobotPose, type SpriteManifest, type SpriteSheet, type Tier } from './types'

/** The Nexus's art (spec Q14, Q16, Q19): direction C, retro 16-bit, generated and then cut, scaled
 *  and mapped onto one 24-colour palette that holds none of the four state colours. Every sheet is
 *  a single still; motion is the scene's (spec Q14). The images carry their own licence
 *  (`sprites/LICENSE`), not the repo's MIT. */

const urls = import.meta.glob<string>('./sprites/*.png', { eager: true, query: '?url', import: 'default' })

const still = (name: string, size: number): SpriteSheet => {
  const src = urls[`./sprites/${name}.png`]
  if (!src) throw new Error(`nexus: no sprite ${name}.png`)
  return { src, w: size, h: size, frames: 1, fps: 1 }
}

const CLASSES: RobotClass[] = ['mech', 'droid', 'drone', 'unknown']
const POSES: RobotPose[] = ['working', 'idle', 'waiting', 'sleeping']
const NEXUS_POSES: NexusPose[] = ['busy', 'waiting', 'idle', 'dead']

const robot = (k: RobotClass) => Object.fromEntries(POSES.map((p) => [p, still(`robot-${k}-${p}`, 64)])) as Record<RobotPose, SpriteSheet>

export const SPRITES: SpriteManifest = {
  robots: Object.fromEntries(CLASSES.map((k) => [k, robot(k)])) as Record<RobotClass, Record<RobotPose, SpriteSheet>>,
  accessories: Array.from({ length: ACCESSORIES }, (_, i) => still(`accessory-${i}`, 64)),
  nexus: Object.fromEntries(NEXUS_POSES.map((p) => [p, still(`nexus-${p}`, 96)])) as Record<NexusPose, SpriteSheet>,
  archive: { 0: still('archive-0', 96), 1: still('archive-1', 96), 2: still('archive-2', 96) } as Record<Tier, SpriteSheet>,
  universal: still('universal', 128),
  packet: still('packet', 16),
}
