import { ACCESSORIES, type RobotClass, type RobotPose } from './ship-types'

/** The Nexus's art: retro 16-bit, generated and then cut, scaled and mapped onto one 24-colour
 *  palette that holds none of the four state colours. Every sheet is a single still; motion is the
 *  scene's. The images carry their own licence (`sprites/LICENSE`), not the repo's MIT. */

/** One drawable: a horizontal strip of `frames` frames, each `w`×`h` pixels, played at `fps`
 *  (1 frame, any fps, is a still). Drawn at an integer scale with `image-rendering: pixelated`. */
export type SpriteSheet = { src: string; w: number; h: number; frames: number; fps: number }

const urls = import.meta.glob<string>('./sprites/*.png', { eager: true, query: '?url', import: 'default' })

const still = (name: string, size: number, h = size): SpriteSheet => {
  const src = urls[`./sprites/${name}.png`]
  if (!src) throw new Error(`nexus: no sprite ${name}.png`)
  return { src, w: size, h, frames: 1, fps: 1 }
}

const CLASSES: RobotClass[] = ['mech', 'droid', 'drone', 'unknown']
const POSES: RobotPose[] = ['working', 'idle', 'waiting', 'sleeping']

const robot = (k: RobotClass) => Object.fromEntries(POSES.map((p) => [p, still(`robot-${k}-${p}`, 64)])) as Record<RobotPose, SpriteSheet>

/** A robot: one 64×64 sheet per class and pose, and `ACCESSORIES` overlays drawn on top of it at
 *  the same size. */
export type SpriteManifest = {
  robots: Record<RobotClass, Record<RobotPose, SpriteSheet>>
  accessories: SpriteSheet[]
}

export const SPRITES: SpriteManifest = {
  robots: Object.fromEntries(CLASSES.map((k) => [k, robot(k)])) as Record<RobotClass, Record<RobotPose, SpriteSheet>>,
  accessories: Array.from({ length: ACCESSORIES }, (_, i) => still(`accessory-${i}`, 64)),
}

export type CaptainSprite = 'busy' | 'idle' | 'alert' | 'offline'

/** v2's art (set 2, same palette and licence): a parent is a captain robot at its console, 96×96 per
 *  pose; a child with no recorded parent stands by an empty command chair (64); a finished child's
 *  shuttle, docked (64×64) and launching (64×96, the flame below); the teleport pad a newborn child
 *  beams in on (64×96). Set 3 (same palette and licence): the deck's archive tower and the props a
 *  robot holds to show what it does (24×24). */
export type ShipSpriteManifest = {
  captain: Record<CaptainSprite, SpriteSheet>
  chair: SpriteSheet
  shuttle: { docked: SpriteSheet; launch: SpriteSheet }
  teleport: SpriteSheet
  /** The deck's archive, its repo's memory vault: a 24×24 tower beside the deck's name. */
  archive: SpriteSheet
  /** What a robot holds to show what it is doing, 24×24, one for every class (`PropKind`). */
  props: Record<PropKind, SpriteSheet>
}

/** A robot's held prop: reading, editing, testing, shipping, a long command (and CI running),
 *  waiting for you, CI green and CI red. */
export type PropKind = 'read' | 'edit' | 'test' | 'ship' | 'run' | 'need' | 'green' | 'red'
const PROPS: PropKind[] = ['read', 'edit', 'test', 'ship', 'run', 'need', 'green', 'red']

export const SHIP_SPRITES: ShipSpriteManifest = {
  captain: { busy: still('captain-busy', 96), idle: still('captain-idle', 96), alert: still('captain-alert', 96), offline: still('captain-offline', 96) },
  chair: still('chair', 64),
  shuttle: { docked: still('ship-docked', 64), launch: still('ship-launch', 64, 96) },
  teleport: still('teleport', 64, 96),
  archive: still('archive', 24),
  props: Object.fromEntries(PROPS.map((k) => [k, still(`prop-${k}`, 24)])) as Record<PropKind, SpriteSheet>,
}
