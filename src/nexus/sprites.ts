import { ACCESSORIES, type NexusPose, type RobotClass, type RobotPose, type SpriteManifest, type SpriteSheet, type Tier } from './types'

/** The Nexus's art (spec Q14, Q16, Q19): direction C, retro 16-bit, generated and then cut, scaled
 *  and mapped onto one 24-colour palette that holds none of the four state colours. Every sheet is
 *  a single still; motion is the scene's (spec Q14). The images carry their own licence
 *  (`sprites/LICENSE`), not the repo's MIT. */

const urls = import.meta.glob<string>('./sprites/*.png', { eager: true, query: '?url', import: 'default' })

const still = (name: string, size: number, h = size): SpriteSheet => {
  const src = urls[`./sprites/${name}.png`]
  if (!src) throw new Error(`nexus: no sprite ${name}.png`)
  return { src, w: size, h, frames: 1, fps: 1 }
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

export type CaptainSprite = 'busy' | 'idle' | 'alert' | 'offline'

/** v2's art (set 2, same palette and licence): a parent is a captain robot at its console, 96×96 per
 *  pose; a child with no recorded parent stands by an empty command chair (64); a finished child's
 *  shuttle, docked (64×64) and launching (64×96, the flame below); the teleport pad a newborn child
 *  beams in on (64×96). */
export type ShipSpriteManifest = {
  captain: Record<CaptainSprite, SpriteSheet>
  chair: SpriteSheet
  shuttle: { docked: SpriteSheet; launch: SpriteSheet }
  teleport: SpriteSheet
}

export const SHIP_SPRITES: ShipSpriteManifest = {
  captain: { busy: still('captain-busy', 96), idle: still('captain-idle', 96), alert: still('captain-alert', 96), offline: still('captain-offline', 96) },
  chair: still('chair', 64),
  shuttle: { docked: still('ship-docked', 64), launch: still('ship-launch', 64, 96) },
  teleport: still('teleport', 64, 96),
}
