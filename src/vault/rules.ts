import type { StaleRow } from './stale'
import type { Badge, Health, RuleRow } from './types'

export const BADGES: Badge[] = ['never', 'stale', 'review', 'inbox']

export const BADGE_LABEL: Record<Badge, string> = { never: 'never', stale: 'stale', review: 'review', inbox: 'inbox' }

export const BADGE_TITLE: Record<Badge, string> = {
  never: 'no reflex emission or MCP read on record',
  stale: 'mnemo stale: cites code that changed in this repo',
  review: 'verified without evidence, or an activation that stopped firing',
  inbox: 'a proposal for this slug is staged in _inbox',
}

/** `mnemo__x`, `project/x` and `x` all name `x`. */
const slugOf = (id: string) => (id.split('/').pop() ?? id).split('__').pop() ?? id

/** The rows `mnemo stale` named (by path, else slug) get `stale`, and its reason joins theirs. */
export function withStale(rows: RuleRow[], stale: StaleRow[] | null): RuleRow[] {
  if (!stale?.length) return rows
  const byPath = new Map(stale.filter((s) => s.path).map((s) => [s.path!, s]))
  const bySlug = new Map(stale.map((s) => [slugOf(s.slug), s]))
  return rows.map((r) => {
    const hit = byPath.get(r.path) ?? bySlug.get(r.slug)
    if (!hit || r.badges.includes('stale')) return r
    const badges = BADGES.filter((b) => b === 'stale' || r.badges.includes(b))
    return { ...r, badges, reasons: hit.reason ? [...r.reasons, `stale: ${hit.reason}`] : r.reasons }
  })
}

export type Chips = {
  /** A page type, or null for every type. */
  type: string | null
  /** A case-folded topic, or null. */
  topic: string | null
  /** Only rows with a badge. */
  problems: boolean
}

export const NO_CHIPS: Chips = { type: null, topic: null, problems: false }

const fold = (t: string) => t.trim().toLowerCase()

export function applyChips(rows: RuleRow[], chips: Chips): RuleRow[] {
  if (!chips.type && !chips.topic && !chips.problems) return rows
  return rows.filter(
    (r) =>
      (!chips.type || r.type === chips.type) &&
      (!chips.topic || r.topics.some((t) => fold(t) === chips.topic)) &&
      (!chips.problems || r.badges.length > 0),
  )
}

export type Facet = { name: string; count: number }

const ranked = (counts: Map<string, number>) => [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))

/** The chips to offer over `rows`: every type, and the `maxTopics` commonest topics. */
export function facets(rows: RuleRow[], maxTopics = 12): { types: Facet[]; topics: Facet[] } {
  const types = new Map<string, number>()
  const topics = new Map<string, number>()
  for (const r of rows) {
    types.set(r.type, (types.get(r.type) ?? 0) + 1)
    for (const t of new Set(r.topics.map(fold).filter(Boolean))) topics.set(t, (topics.get(t) ?? 0) + 1)
  }
  return { types: ranked(types), topics: ranked(topics).slice(0, maxTopics) }
}

/** The scopes to offer: every rule, `shared`, the current repo, then the other agents by name. */
export function scopeAgents(known: readonly string[], current: string | undefined): string[] {
  const rest = [...new Set(known)].filter((a) => a !== 'shared' && a !== current).sort()
  return ['shared', ...(current && current !== 'shared' ? [current] : []), ...rest]
}

/** Rules needing review: verified without evidence or dormant (one count per page), plus stale ones. */
export function reviewCount(health: Health | null, stale: StaleRow[] | null): number {
  const pages = new Set([...(health?.label_only ?? []), ...(health?.dormant ?? [])].map((r) => r.path || r.slug))
  const slugs = new Set([...(health?.label_only ?? []), ...(health?.dormant ?? [])].map((r) => r.slug))
  for (const s of stale ?? []) if (!slugs.has(slugOf(s.slug)) && !(s.path && pages.has(s.path))) pages.add(s.path ?? `stale:${s.slug}`)
  return pages.size
}

const DAY = 24 * 60 * 60 * 1000

/** `today`, `3d ago`, or the date past ninety days. */
export function sinceText(ms: number | null, now = Date.now()): string {
  if (ms === null) return '—'
  const days = Math.floor(Math.max(0, now - ms) / DAY)
  if (days === 0) return 'today'
  return days <= 90 ? `${days}d ago` : new Date(ms).toISOString().slice(0, 10)
}

export type Tone = 'ok' | 'warn' | 'bad' | 'muted' | 'accent'

/** Colour of a confidence: verified green, verified elsewhere / by CI accent, inferred grey,
 *  demoted red, anything else (none, observed…) yellow. */
export function confidenceTone(confidence: string | null): Tone {
  const c = (confidence ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-')
  if (c === 'verified') return 'ok'
  if (c === 'ci' || c.startsWith('verified-')) return 'accent'
  if (c === 'inferred') return 'muted'
  if (c === 'demoted') return 'bad'
  return 'warn'
}
