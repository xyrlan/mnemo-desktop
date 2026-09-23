import type { RuleHit } from './types'

export type HitGroup = { slug: string; count: number; last: number | null }

/** `injected` collapsed to one row per slug (a long session re-injects the same rule many
 *  times), most recently fired first. */
export function groupHits(hits: RuleHit[]): HitGroup[] {
  const by = new Map<string, HitGroup>()
  for (const h of hits) {
    const g = by.get(h.slug) ?? { slug: h.slug, count: 0, last: null }
    g.count += 1
    if (h.at !== null && (g.last === null || h.at > g.last)) g.last = h.at
    by.set(h.slug, g)
  }
  return [...by.values()].sort((a, b) => (b.last ?? -Infinity) - (a.last ?? -Infinity))
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** `just now`, `12m ago`, `3h ago`, `2d ago`; `''` for an undated row. */
export function since(ms: number | null, now = Date.now()): string {
  if (ms === null) return ''
  const delta = Math.max(0, now - ms)
  if (delta < MINUTE) return 'just now'
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`
  return `${Math.floor(delta / DAY)}d ago`
}
