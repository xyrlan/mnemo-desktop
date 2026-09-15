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
