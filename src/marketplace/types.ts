/** One `.mnemo-shared/` tree in a source, as `marketplace.rs` lists it. */
export type RuleSet = {
  source: string
  name: string
  /** Absolute tree path, what `marketplace_import` takes. Empty when `error` is set. */
  path: string
  description: string
  rule_count: number
  types: Record<string, number>
  topics: string[]
  projects: string[]
  last_commit: string | null
  /** The source could not be fetched, or holds no tree. */
  error: string | null
}

export type SourceGroup = { source: string; sets: RuleSet[] }

/** Sets grouped under their source, in the order the Rust side listed them. */
export function groupBySource(sets: RuleSet[]): SourceGroup[] {
  const groups: SourceGroup[] = []
  for (const s of sets) {
    const g = groups.find((x) => x.source === s.source)
    if (g) g.sets.push(s)
    else groups.push({ source: s.source, sets: [s] })
  }
  return groups
}

/** `{ feedback: 3, project: 1 }` → `3 feedback · 1 project`. */
export function typeSummary(types: Record<string, number>): string {
  return Object.entries(types)
    .map(([t, n]) => `${n} ${t}`)
    .join(' · ')
}

/** How a rule in this repo's tree stands against the local vault (`classify` in Rust). */
export type Standing = 'new' | 'changed' | 'same' | 'yours'

export const STANDINGS: Standing[] = ['new', 'changed', 'yours', 'same']

export type RepoRule = {
  slug: string
  page_type: string
  description: string
  /** `<type>/<file>.md` inside the tree. */
  rel: string
  /** Null when no local vault was found to compare with. */
  standing: Standing | null
}

/** The "this repo" section: the focused pane's working copy and its `.mnemo-shared/`. */
export type RepoRules = {
  root: string
  name: string
  /** The tree as a rule set, what Import takes; null when nothing is published. */
  set: RuleSet | null
  rules: RepoRule[]
  vault: string | null
  default_branch: string | null
  branch: string | null
  /** The tree has changes git has not committed. */
  uncommitted: boolean
  error: string | null
}

export type Published = { output: string; uncommitted: boolean }

export type OpenedPr = { branch: string; base: string; url: string; output: string }

/** Rules per standing; unclassified ones are not counted. */
export function countStandings(rules: RepoRule[]): Record<Standing, number> {
  const n: Record<Standing, number> = { new: 0, changed: 0, same: 0, yours: 0 }
  for (const r of rules) if (r.standing) n[r.standing]++
  return n
}
