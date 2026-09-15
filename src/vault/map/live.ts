import { mix, withAlpha, type EdgeAttrs, type NodeAttrs, type Palette, type Recolour } from './model'

/** A fired rule flashes this long, as in the ego view. */
export const FIRE_MS = 2000
/** A page just born pulses, and its edges draw in, this long. */
export const BORN_MS = 4000
/** A rewritten or demoted page changes colour over this long. */
export const FADE_MS = 900

/** 0 → 1 over `ms` from `at`. */
const progress = (now: number, at: number, ms: number) => Math.max(0, Math.min(1, (now - at) / ms))

/** A quick rise then a long fall: 0 at the ends, 1 at 15 %. */
export function pulse(t: number): number {
  if (t <= 0 || t >= 1) return 0
  return t < 0.15 ? t / 0.15 : (1 - (t - 0.15) / 0.85) ** 2
}

type Timed = { at: number }

/** What is animating on the map, by node id, and how each node and edge looks at `now`.
 *  The renderer asks `active` each frame and stops its loop when nothing is. */
export class Effects {
  private fired = new Map<string, Timed>()
  private born = new Map<string, Timed>()
  private fades = new Map<string, Timed & { from: string; to: string }>()

  fire(ids: readonly string[], now: number) {
    for (const id of ids) this.fired.set(id, { at: now })
  }

  birth(ids: readonly string[], now: number) {
    for (const id of ids) this.born.set(id, { at: now })
  }

  recolour(changes: readonly Recolour[], now: number) {
    for (const c of changes) {
      // Mid-fade, start from the colour showing now.
      const shown = this.fades.get(c.id)
      const from = shown ? mix(shown.from, shown.to, progress(now, shown.at, FADE_MS)) : c.from
      this.fades.set(c.id, { at: now, from, to: c.to })
    }
  }

  /** Drops what has finished; true while anything still animates. */
  active(now: number): boolean {
    const prune = (m: Map<string, Timed>, ms: number) => m.forEach((v, k) => now - v.at >= ms && m.delete(k))
    prune(this.fired, FIRE_MS)
    prune(this.born, BORN_MS)
    prune(this.fades, FADE_MS)
    return this.fired.size + this.born.size + this.fades.size > 0
  }

  /** Every node an effect touches, for a partial refresh. */
  ids(): string[] {
    return [...new Set([...this.fired.keys(), ...this.born.keys(), ...this.fades.keys()])]
  }

  node(id: string, a: NodeAttrs, now: number, p: Palette): Partial<NodeAttrs> & { forceLabel?: boolean; zIndex?: number; highlighted?: boolean } | null {
    const fire = this.fired.get(id)
    const born = this.born.get(id)
    const fade = this.fades.get(id)
    if (!fire && !born && !fade) return null
    let color = fade ? mix(fade.from, fade.to, progress(now, fade.at, FADE_MS)) : a.color
    let size = a.size
    if (fire) {
      const k = pulse(progress(now, fire.at, FIRE_MS))
      color = mix(color, p.glow, k * 0.85)
      size *= 1 + 0.9 * k
    }
    if (born) {
      const t = progress(now, born.at, BORN_MS)
      // Starts large and bright and settles to its own size and colour.
      size *= 1 + 2.2 * (1 - t) ** 3
      color = mix(color, p.glow, 0.7 * (1 - t) ** 2)
    }
    return { color, size, forceLabel: true, zIndex: 2, highlighted: !!fire || (!!born && progress(now, born.at, BORN_MS) < 0.6) }
  }

  /** Edges touching a firing node glow; the edges of a page just born fade in. */
  edge(source: string, target: string, a: EdgeAttrs, now: number, p: Palette): Partial<EdgeAttrs> & { zIndex?: number } | null {
    const fire = this.fired.get(source) ?? this.fired.get(target)
    const born = this.born.get(source) ?? this.born.get(target)
    if (!fire && !born) return null
    if (born) {
      const t = progress(now, born.at, Math.min(BORN_MS, 1200))
      const alpha = parseInt(a.color.slice(7, 9) || 'ff', 16) / 255
      return { color: withAlpha(a.color, alpha * t) }
    }
    const k = pulse(progress(now, fire!.at, FIRE_MS))
    return { color: withAlpha(p.glow, 0.25 + 0.6 * k), size: a.size + 1.5 * k, zIndex: 1 }
  }
}
