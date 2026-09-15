/** `mnemo why --json`: the last reflex decisions, newest first. */
export type Decision = {
  ts: string
  project: string
  /** Rule ids that fired, `<project>__<slug>` or a bare slug. */
  emitted: string[]
  scores: number[]
  /** Why nothing fired (`relative_gap_fail`, …); null when something did. */
  silence_reason: string | null
  /** `[rule id, score]`, best first. */
  candidates: [string, number][]
}

/** The decisions in `stdout`, or null when it is not the JSON `why` prints. */
export function parseWhy(stdout: string): Decision[] | null {
  let raw: unknown
  try {
    raw = JSON.parse(stdout)
  } catch {
    return null
  }
  if (!Array.isArray(raw)) return null
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  return raw
    .filter((d): d is Record<string, unknown> => !!d && typeof d === 'object')
    .map((d) => ({
      ts: typeof d.ts === 'string' ? d.ts : '',
      project: typeof d.project === 'string' ? d.project : '',
      emitted: strs(d.emitted),
      scores: Array.isArray(d.scores) ? d.scores.filter((x): x is number => typeof x === 'number') : [],
      silence_reason: typeof d.silence_reason === 'string' ? d.silence_reason : null,
      candidates: (Array.isArray(d.candidates) ? d.candidates : [])
        .filter((c): c is [string, number] => Array.isArray(c) && typeof c[0] === 'string')
        .map((c) => [c[0], typeof c[1] === 'number' ? c[1] : 0] as [string, number]),
    }))
}

/** A rule id names this slug: `mnemo__x`, `project/x` and `x` all name `x`. */
export const namesRule = (id: string, slug: string) => id === slug || id.endsWith(`__${slug}`) || id.endsWith(`/${slug}`)

export const mentions = (d: Decision, slug: string) => [...d.emitted, ...d.candidates.map((c) => c[0])].some((id) => namesRule(id, slug))

/** The decisions that mention `slug`, or all of them when none does (or no slug). */
export function decisionsFor(all: Decision[], slug: string | undefined): { shown: Decision[]; matched: boolean } {
  const hits = slug ? all.filter((d) => mentions(d, slug)) : []
  return hits.length ? { shown: hits, matched: true } : { shown: all, matched: false }
}
