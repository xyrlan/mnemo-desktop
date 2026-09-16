/** The vault as a level, a health colour and a halo: pure functions over `VaultLevel`. */
import type { VaultLevel } from './types'

/* ------------------------------------------------------------------ calibration --
   Everything the maintainer tunes by looking at the square lives here and nowhere else.
   Measured on the live vault by `cargo test --lib level_live -- --ignored --nocapture`
   (2026-09-16): 2,413 live pages, 386 fired at least once, 576 fires on record,
   320 fired in the last 7 days, 646 dormant, 0 label-only, 195 staged in `_inbox`.
   (The spec's 3,579 / 104 counted every `.md` and only reflex emissions; the square reads
   live pages and MCP reads too, which is what `vault_level` returns.) */

/** xp per page that has ever fired. With 386 fired pages, 5 makes reach ~40% of xp. */
export const XP_PER_FIRED_RULE = 5
/** xp per fire on record, so the bar keeps moving with use once reach saturates. */
export const XP_PER_FIRE = 1
/** xp per level. Linear on purpose: the only curve where the bar visibly moves. */
export const XP_PER_LEVEL = 100

/** Health is a weighted sum of four scores in [0, 1]; the weights add to 1. */
export const HEALTH_WEIGHTS = {
  /** Share of pages that ever fired, against `REACH_TARGET`. */
  reach: 0.35,
  /** Share of pages that are not dormant, against `DORMANT_CEILING`. */
  dormant: 0.35,
  /** Share of pages not verified-without-evidence, against `LABEL_ONLY_CEILING`. */
  labelOnly: 0.1,
  /** Staged proposals waiting, against `INBOX_CEILING`. */
  inbox: 0.2,
} as const
/** This share of pages having fired scores full reach. */
export const REACH_TARGET = 0.2
/** This share of pages dormant scores zero. */
export const DORMANT_CEILING = 0.5
/** This share of pages label-only scores zero. */
export const LABEL_ONLY_CEILING = 0.1
/** This many staged proposals scores zero. */
export const INBOX_CEILING = 200
/** Five tones so the slide is legible before it is bad, each the floor of its band.
 *  Three poses group them (`POSE_OF`): the eye reads colour better than silhouette at 160px. */
export const HEALTH_GREEN = 0.7
export const HEALTH_LIME = 0.58
export const HEALTH_YELLOW = 0.45
export const HEALTH_ORANGE = 0.3
/** The fire lights at green health *and* at least this many pages fired in the last 7 days
 *  (`RECENT_FIRE_DAYS` in `vault.rs`): sustained use, not one lucky afternoon. */
export const FIRE_MIN_RECENT = 25

/** Halo: one band of dots per this many pages, `HALO_PER_BAND` dots a band. The ceiling is
 *  what a 160px square still reads as separate marks — a live 2,413-page vault sits at 128,
 *  so the halo is still growing rather than saturated. */
export const HALO_BAND_PAGES = 120
export const HALO_PER_BAND = 5
export const HALO_MIN_DOTS = 12
export const HALO_MAX_DOTS = 160
/* ------------------------------------------------------------------------------- */

export function xpOf(v: Pick<VaultLevel, 'pages' | 'rules_fired' | 'fires'>): number {
  return v.pages + XP_PER_FIRED_RULE * v.rules_fired + XP_PER_FIRE * v.fires
}

export type Progress = { level: number; into: number; fraction: number }

/** The level of `bestXp`, and how far into the next one. */
export function levelOf(bestXp: number): Progress {
  const xp = Math.max(0, Math.floor(bestXp))
  const into = xp % XP_PER_LEVEL
  return { level: Math.floor(xp / XP_PER_LEVEL), into, fraction: into / XP_PER_LEVEL }
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0)

/** 0 (sick) to 1 (thriving). An empty vault is 0: there is nothing to be healthy about. */
export function healthOf(v: Pick<VaultLevel, 'pages' | 'rules_fired' | 'dormant' | 'label_only' | 'inbox'>): number {
  if (v.pages <= 0) return 0
  const w = HEALTH_WEIGHTS
  const reach = clamp01(v.rules_fired / v.pages / REACH_TARGET)
  const awake = 1 - clamp01(v.dormant / v.pages / DORMANT_CEILING)
  const grounded = 1 - clamp01(v.label_only / v.pages / LABEL_ONLY_CEILING)
  const triaged = 1 - clamp01(v.inbox / INBOX_CEILING)
  return w.reach * reach + w.dormant * awake + w.labelOnly * grounded + w.inbox * triaged
}

export type Tone = 'green' | 'lime' | 'yellow' | 'orange' | 'red'

export function toneOf(health: number): Tone {
  if (health >= HEALTH_GREEN) return 'green'
  if (health >= HEALTH_LIME) return 'lime'
  if (health >= HEALTH_YELLOW) return 'yellow'
  if (health >= HEALTH_ORANGE) return 'orange'
  return 'red'
}

/** Which of the three poses a tone wears. Five silhouettes would be indistinguishable in a
 *  160px square; five colours are not. */
export type Pose = 'well' | 'fair' | 'poor'

export const POSE_OF: Record<Tone, Pose> = {
  green: 'well',
  lime: 'well',
  yellow: 'fair',
  orange: 'poor',
  red: 'poor',
}

export const poseOf = (tone: Tone): Pose => POSE_OF[tone]

export function onFire(health: number, firedRecent: number): boolean {
  return health >= HEALTH_GREEN && firedRecent >= FIRE_MIN_RECENT
}

/** How many dots the halo draws for `pages`: grows a band at a time, never per page. */
export function haloDots(pages: number): number {
  const bands = Math.floor(Math.max(0, pages) / HALO_BAND_PAGES)
  return Math.min(HALO_MAX_DOTS, HALO_MIN_DOTS + bands * HALO_PER_BAND)
}

/** A fragment of memory rising through the square: it appears at the bottom edge and fades out
 *  at the top. `x` is its column and `w`/`h` its size; `a` is its tilt in degrees; `depth` 0
 *  (near) to 1 (far) makes the far ones smaller, dimmer, softer and slower. `rise` is the
 *  seconds one climb takes and `delay` where in that climb it starts, so the rain is already
 *  falling when the square mounts rather than starting as one flat wave. `sway` is how far it
 *  drifts sideways on the way up. */
export type Dot = { x: number; w: number; h: number; a: number; depth: number; rise: number; delay: number; sway: number }

/** The golden ratio's fractional part: stepping by it spreads a sequence evenly across [0, 1)
 *  without ever repeating, which is what keeps the columns and the start times from banding. */
const PHI = 0.6180339887

/** `n` fragments raining upward through a `size` square. Deterministic, so a re-render never
 *  reshuffles them: the same vault always draws the same rain.
 *
 *  Only `x` is a position — `y` belongs to the animation, which carries each fragment from
 *  below the bottom edge to above the top one. */
export function haloLayout(n: number, size: number): Dot[] {
  return Array.from({ length: n }, (_, i) => {
    // Depth cycles rather than ramping, so near and far fragments are interleaved across the
    // width instead of the near ones all landing on one side.
    const depth = ((i * 7) % 11) / 10
    const side = (5.4 - 3.9 * depth) * (i % 7 === 0 ? 1.2 : i % 3 === 0 ? 1 : 0.78)
    const rise = 7 + depth * 9
    return {
      // Golden-ratio columns, inset so nothing clips the sides.
      x: size * 0.04 + ((i * PHI) % 1) * size * 0.92,
      w: side,
      // Slightly off-square: a note is taller than it is wide.
      h: side * 1.15,
      a: ((i * 37) % 4) * 11 - 16,
      depth,
      // Near fragments rise faster than far ones (7s to 16s): parallax, not a uniform curtain.
      rise,
      // A negative delay starts the fragment mid-climb, so the rain is already underway.
      delay: -((i * PHI * 3) % 1) * rise,
      // Sideways drift on the way up, alternating, larger for the near ones.
      sway: (i % 2 ? 1 : -1) * (2 + (1 - depth) * 6),
    }
  })
}

/** Which dots a pulse lights: a few, picked from its id so each pulse flashes a different patch. */
export function flashed(id: number, n: number, count = 5): Set<number> {
  const out = new Set<number>()
  if (n <= 0) return out
  const start = (id * 7919) % n
  for (let k = 0; k < Math.min(count, n); k++) out.add((start + k * 3) % n)
  return out
}
