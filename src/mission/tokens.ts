import type { ChildSession, ParentSession, RepoGroup } from './types'

/** 950, 12k, 210k, 1.2M: short enough for a sidebar row. */
export function fmtTokens(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0'
  if (n < 1000) return String(Math.round(n))
  if (n < 999_500) return `${trim(n / 1000)}k`
  return `${trim(n / 1_000_000)}M`
}

/** One decimal under 10 (1.2k, 3.4M), none above (210k). */
function trim(v: number): string {
  return v < 9.95 ? String(Math.round(v * 10) / 10) : String(Math.round(v))
}

/** The token fields of a parent, 0 when the snapshot predates them. */
export function parentTokens(p: ParentSession): { tokens: number; cacheRead: number; children: number } {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  return { tokens: num(p.tokens), cacheRead: num(p.cache_read), children: num(p.children_tokens) }
}

/** `parent 210k · children 640k`, or null when the snapshot carries no counts for this parent. */
export function parentTokenLine(p: ParentSession): string | null {
  const t = parentTokens(p)
  if (!t.tokens && !t.children) return null
  return `parent ${fmtTokens(t.tokens)} · children ${fmtTokens(t.children)}`
}

/** Children in a repo group that the snapshot links to this parent. */
export function childrenOf(r: RepoGroup, sessionId: string): ChildSession[] {
  const all = [...r.missions.flatMap((m) => m.pieces.map((p) => p.child)), ...r.children]
  const seen = new Set<string>()
  return all.filter((c): c is ChildSession => {
    if (!c || c.parent_session !== sessionId || seen.has(c.id)) return false
    seen.add(c.id)
    return true
  })
}
