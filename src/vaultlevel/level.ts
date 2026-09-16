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

/** A fragment of memory: a small tilted square, the way a note looks from across the room.
 *  `w`/`h` are its size, `a` its rotation in degrees. */
export type Dot = { x: number; y: number; w: number; h: number; a: number }

const GOLDEN = Math.PI * (3 - Math.sqrt(5))

/** `n` fragments on a sunflower spiral inside a `size` square, clear of the centre where the
 *  octopus sits. Deterministic, so a re-render never reshuffles them: the same vault always
 *  draws the same halo. Sizes and tilts vary by index so the field reads as scattered notes
 *  rather than a printed pattern. */
export function haloLayout(n: number, size: number): Dot[] {
  const c = size / 2
  const inner = size * 0.19
  const outer = size * 0.485
  return Array.from({ length: n }, (_, i) => {
    const t = Math.sqrt((i + 0.5) / Math.max(1, n))
    const rad = inner + (outer - inner) * t
    const a = i * GOLDEN
    // Three sizes in a fixed rotation: a few larger notes carry the field, the rest fill it.
    const side = i % 7 === 0 ? 3.4 : i % 3 === 0 ? 2.6 : 2
    return {
      x: c + rad * Math.cos(a) - side / 2,
      y: c + rad * Math.sin(a) - side / 2,
      w: side,
      // Slightly off-square: a note is taller than it is wide.
      h: side * 1.15,
      a: ((i * 37) % 4) * 11 - 16,
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
