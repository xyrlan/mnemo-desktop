/** Fuzzy matching for the jump palette: which worktrees a query finds, how well, and which
 *  characters of each field to highlight. Pure, so the palette's order is tested without a DOM. */

export type MatchRange = { start: number; end: number }

/** Where `query` sits in `text`, or null. A substring wins (and a prefix or a word start wins
 *  more); otherwise the query's characters in order, each run of adjacent ones one range. Case
 *  is ignored. A higher score is a better match. */
export function fuzzyMatch(text: string, query: string): { score: number; ranges: MatchRange[] } | null {
  const q = query.toLowerCase()
  if (!q) return { score: 0, ranges: [] }
  const t = text.toLowerCase()
  const at = t.indexOf(q)
  if (at >= 0) {
    const boundary = at === 0 ? 40 : /[\s/_.\-]/.test(t[at - 1]) ? 20 : 0
    return { score: 100 + boundary - Math.min(at, 20) + (q.length === t.length ? 30 : 0), ranges: [{ start: at, end: at + q.length }] }
  }
  const ranges: MatchRange[] = []
  let i = 0
  let gaps = 0
  for (const ch of q) {
    const found = t.indexOf(ch, i)
    if (found < 0) return null
    const last = ranges[ranges.length - 1]
    if (last && last.end === found) last.end = found + 1
    else {
      if (last) gaps += found - last.end
      ranges.push({ start: found, end: found + 1 })
    }
    i = found + 1
  }
  // Fewer, tighter runs read as the intended word; a scatter across the whole text barely counts.
  return { score: Math.max(1, 60 - ranges.length * 8 - Math.min(gaps, 30)), ranges }
}

export type Fields = { name: string; branch: string; repo: string }
export type FieldRanges = { name: MatchRange[]; branch: MatchRange[]; repo: MatchRange[] }

const NONE: FieldRanges = { name: [], branch: [], repo: [] }
/** A field's weight: the name is what you mean first, the branch next, the repo last. */
const WEIGHT: Record<keyof Fields, number> = { name: 3, branch: 2, repo: 1 }

/** Matches every whitespace-separated word of `query` against one worktree's fields; each word
 *  must match some field. Null when one does not. An empty query matches with no highlight. */
export function matchWorktree(fields: Fields, query: string): { score: number; ranges: FieldRanges } | null {
  const words = query.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return { score: 0, ranges: NONE }
  const ranges: FieldRanges = { name: [], branch: [], repo: [] }
  let score = 0
  for (const word of words) {
    let best: { key: keyof Fields; score: number; ranges: MatchRange[] } | null = null
    for (const key of Object.keys(WEIGHT) as (keyof Fields)[]) {
      const m = fuzzyMatch(fields[key], word)
      if (m && (!best || m.score * WEIGHT[key] > best.score)) best = { key, score: m.score * WEIGHT[key], ranges: m.ranges }
    }
    if (!best) return null
    score += best.score
    ranges[best.key] = merge([...ranges[best.key], ...best.ranges])
  }
  return { score, ranges }
}

/** Sorted, with overlapping or touching ranges joined, as `HighlightedText` expects. */
export function merge(ranges: MatchRange[]): MatchRange[] {
  const out: MatchRange[] = []
  for (const r of [...ranges].sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1]
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end)
    else out.push({ ...r })
  }
  return out
}
