// What the Memory panel works out from what the vault's stores hold. Pure, so each is a test.

import { samePath } from '../../path/path'
import { parseStale, type StaleRow } from '../../vault/stale'
import type { GraphEdge, RuleRow, RunResult } from '../../vault/types'

export type MemoryTab = 'activity' | 'rules' | 'pages' | 'inbox'

export type Repo = { root: string; name: string }

/** The picked repo while it is still known, else the first; null with none. */
export function pickRepo<R extends Repo>(repos: readonly R[], chosen: string | null): R | null {
  return (chosen !== null ? repos.find((r) => samePath(r.root, chosen)) : undefined) ?? repos[0] ?? null
}

/** A project of the rules table: every rule mnemo holds for one agent. */
export type Project = {
  name: string
  rules: number
  /** Rules that carry a badge: never fired, stale, wanting review, a rewrite staged. */
  problems: number
  /** The hottest rule's heat, for the project's bar. */
  heat: number
  /** The repo the panel is on. */
  current: boolean
}

/** The rules by project: the repo the panel is on first, `shared` second, then the others, the
 *  one with most rules first and by name on a tie. `rows` come hottest first, so a project's
 *  first row is its hottest. */
export function projectsOf(rows: readonly RuleRow[], current: string | undefined): Project[] {
  const by = new Map<string, Project>()
  for (const r of rows) {
    const p = by.get(r.agent) ?? { name: r.agent, rules: 0, problems: 0, heat: 0, current: r.agent === current }
    p.rules++
    if (r.badges.length) p.problems++
    p.heat = Math.max(p.heat, r.heat)
    by.set(r.agent, p)
  }
  const rank = (p: Project) => (p.current ? 0 : p.name === 'shared' ? 1 : 2)
  return [...by.values()].sort((a, b) => rank(a) - rank(b) || b.rules - a.rules || a.name.localeCompare(b.name))
}

/** The rows of `project`; every row when it is null, or when the table no longer names it (a
 *  filter typed since left it with none). */
export function inProject(rows: RuleRow[], project: string | null): RuleRow[] {
  if (project === null || !rows.some((r) => r.agent === project)) return rows
  return rows.filter((r) => r.agent === project)
}

/** What `mnemo stale --json` named. Exit 0 with nothing printed is nothing stale, not a failed
 *  read; null before it ran and when what it printed is not its JSON. */
export function staleRows(stale: RunResult | null): StaleRow[] | null {
  if (!stale) return null
  return stale.code === 0 && !stale.stdout.trim() ? [] : parseStale(stale.stdout)
}

/** The row `by` steps from `selected`, held at both ends; from nothing selected, the first. */
export function step<T extends { path: string }>(rows: readonly T[], selected: string | null, by: number): T | undefined {
  const i = rows.findIndex((r) => r.path === selected)
  return rows[Math.max(0, Math.min(rows.length - 1, i + by))]
}

/** How a neighbour stands to the centre: the links each way, or the topics they share. */
export function relation(center: string, id: string, edges: readonly GraphEdge[]): string {
  const of = edges.filter((e) => (e.source === center && e.target === id) || (e.target === center && e.source === id))
  const parts: string[] = []
  if (of.some((e) => e.kind === 'link' && e.source === center)) parts.push('links to it')
  if (of.some((e) => e.kind === 'link' && e.target === center)) parts.push('links here')
  const topics = of.filter((e) => e.kind === 'topic').map((e) => e.label)
  if (topics.length) parts.push(`shares ${topics.join(', ')}`)
  return parts.join(' · ') || 'nearby'
}

/** `12s`, `1m 05s`. */
export function elapsedText(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

/** What a run printed, both streams, as one text. */
export const printed = (r: RunResult) => [r.stdout.trimEnd(), r.stderr.trimEnd()].filter(Boolean).join('\n')

/** How a run ended, in a word: `exit 0`, `exit 2`, or `not run` when it could not start, was
 *  stopped, or died on a signal. */
export const ended = (r: RunResult) => (r.code === null ? 'not run' : `exit ${r.code}`)
