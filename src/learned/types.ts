/** The JSON of the install review, as mnemo's spec defines it (`2026-09-24-install-review-design.md`,
 *  *Interface*), and the reading of it. Every reader takes the text a call printed and returns
 *  null (or an error) for anything else, so a CLI that says something unexpected shows as what
 *  it said instead of as an empty screen. Pure: the fixtures in `./fixtures` are its tests. */

/** `mnemo backfill --project P --dry-run --json` */
export type DryRun = { project: string; sessions: number; callsEstimate: number; priceUsd: number | null }

/** One page of `mnemo inbox --origin backfill --project P --json`. */
export type LearnedPage = {
  key: string
  type: string
  name: string
  description: string
  excerpt: string
  stagedAt: string
  expiresAt: string
}

export type Listing = { project: string; pages: LearnedPage[] }

/** `mnemo inbox --promote|--drop … --json`: the keys it decided and the ones it could not. */
export type Decided = { done: string[]; failed: { key: string; error: string }[] }

/** One `--progress-json` line. */
export type Progress =
  | { event: 'harvest' | 'extract'; done: number; of: number }
  | { event: 'done'; staged: number; live: number; failed: number }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** The one JSON document a call printed. The spec puts only that on stdout; a line of noise
 *  before it (a warning a hook printed) is skipped, not taken for the answer. */
export function jsonOf(stdout: string): unknown {
  const text = stdout.trim()
  try {
    return JSON.parse(text)
  } catch {
    const at = text.search(/^\{/m)
    if (at <= 0) return undefined
    try {
      return JSON.parse(text.slice(at))
    } catch {
      return undefined
    }
  }
}

export function parseDryRun(stdout: string): DryRun | null {
  const v = jsonOf(stdout)
  if (!isObj(v)) return null
  const sessions = num(v.sessions)
  if (sessions === null) return null
  return { project: str(v.project), sessions, callsEstimate: num(v.calls_estimate) ?? 0, priceUsd: num(v.api_price_estimate_usd) }
}

export function parseListing(stdout: string): Listing | null {
  const v = jsonOf(stdout)
  if (!isObj(v) || !Array.isArray(v.pages)) return null
  const pages = v.pages.filter(isObj).flatMap((p): LearnedPage[] => {
    const key = str(p.key)
    if (!key) return []
    return [
      {
        key,
        type: str(p.type) || key.split('/')[0] || 'other',
        name: str(p.name) || key,
        description: str(p.description),
        excerpt: str(p.excerpt),
        stagedAt: str(p.staged_at),
        expiresAt: str(p.expires_at),
      },
    ]
  })
  return { project: str(v.project), pages }
}

/** `field` is `promoted` or `dropped`. */
export function parseDecided(stdout: string, field: 'promoted' | 'dropped'): Decided | null {
  const v = jsonOf(stdout)
  if (!isObj(v) || !Array.isArray(v[field])) return null
  const failed = Array.isArray(v.failed) ? v.failed.filter(isObj).map((f) => ({ key: str(f.key), error: str(f.error) })) : []
  return { done: (v[field] as unknown[]).filter((k): k is string => typeof k === 'string'), failed }
}

/** One line of the run's stdout, or null when it is not a progress event. */
export function parseProgress(line: string): Progress | null {
  let v: unknown
  try {
    v = JSON.parse(line)
  } catch {
    return null
  }
  if (!isObj(v)) return null
  if (v.event === 'harvest' || v.event === 'extract') {
    const done = num(v.done)
    const of = num(v.of)
    return done === null || of === null ? null : { event: v.event, done, of }
  }
  if (v.event === 'done') return { event: 'done', staged: num(v.staged) ?? 0, live: num(v.live) ?? 0, failed: num(v.failed) ?? 0 }
  return null
}

/** The groups of the review, in the spec's order; any other type follows under its own name. */
export const GROUPS: { type: string; label: string }[] = [
  { type: 'project', label: 'Project facts' },
  { type: 'feedback', label: 'Your rules' },
  { type: 'reference', label: 'Technical references' },
]

export type Group = { type: string; label: string; pages: LearnedPage[] }

export function groupPages(pages: LearnedPage[]): Group[] {
  const known = GROUPS.map((g) => ({ ...g, pages: pages.filter((p) => p.type === g.type) }))
  const others = [...new Set(pages.map((p) => p.type))]
    .filter((t) => !GROUPS.some((g) => g.type === t))
    .sort()
    .map((type) => ({ type, label: type, pages: pages.filter((p) => p.type === type) }))
  return [...known, ...others].filter((g) => g.pages.length > 0)
}

/** The first expiry of the listing: when undecided pages start to go. Null when none says. */
export function firstExpiry(pages: LearnedPage[]): string | null {
  const all = pages.map((p) => p.expiresAt).filter(Boolean).sort()
  return all[0] ?? null
}

/** `2026-10-08T10:12:03` → `2026-10-08`. */
export const day = (iso: string) => iso.slice(0, 10)
