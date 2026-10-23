import type { JarvisProject } from './client'

/** Which project a request is about (#505 decision 2): the first of these that gives exactly one
 *  of the known projects, else ask.
 *  1. the project the maintainer named (its name, an alias or its folder's name);
 *  2. the title of the window in front (`jarvis_focused_window`, never a screenshot);
 *  3. the project of the last few minutes.
 *  Naming more than one narrows the later steps to those named. */

/** How long the project of the last request stays "the one we were talking about". */
export const RECENT_MS = 5 * 60_000

export type Recent = { project: string; at: number } | null

export type Inference =
  | { kind: 'one'; project: string; by: 'named' | 'window' | 'recent' }
  /** None of the steps gave exactly one: `candidates` are the projects a step found, when it
   *  found more than one; empty when none was found anywhere. */
  | { kind: 'ask'; candidates: string[] }

/** Lower case, accents off: "Memória" and "memoria" are the same word when spoken. */
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** A name's word may hold `-` and `_`: "mnemo" is not found inside "mnemo-desktop". */
const WORD = /[\p{L}\p{N}_-]/u

const base = (root: string) => root.split(/[\\/]/).filter(Boolean).pop() ?? ''

/** Every way the maintainer may write or say a project: its name, aliases and folder, and each
 *  of them with `-` and `_` spoken as a space ("mnemo src"). */
function terms(p: JarvisProject): string[] {
  const all = [p.name, ...p.aliases, base(p.root)].map(fold).filter((t) => t.trim())
  return [...new Set(all.flatMap((t) => [t, t.replace(/[-_]+/g, ' ')]))]
}

type Hit = { project: string; from: number; to: number }

function hits(text: string, projects: JarvisProject[]): Hit[] {
  const t = fold(text)
  const out: Hit[] = []
  for (const p of projects)
    for (const term of terms(p))
      for (let i = t.indexOf(term); i >= 0; i = t.indexOf(term, i + 1)) {
        const to = i + term.length
        if ((i > 0 && WORD.test(t[i - 1])) || (to < t.length && WORD.test(t[to]))) continue
        out.push({ project: p.name, from: i, to })
      }
  return out
}

/** The projects `text` names, in the order first named. A name found inside a longer one
 *  ("mnemo" in "mnemo desktop") does not count. */
export function projectsIn(text: string, projects: JarvisProject[]): string[] {
  const all = hits(text, projects)
  const kept = all.filter((h) => !all.some((o) => o !== h && o.project !== h.project && o.from <= h.from && o.to >= h.to && o.to - o.from > h.to - h.from))
  kept.sort((a, b) => a.from - b.from)
  return [...new Set(kept.map((h) => h.project))]
}

export type InferInput = {
  /** The maintainer's words (with the answer to a question Jarvis asked, when there was one). */
  request: string
  /** The title of the window in front, null when unknown. */
  window: string | null
  recent: Recent
  now: number
  projects: JarvisProject[]
}

export function inferProject({ request, window, recent, now, projects }: InferInput): Inference {
  const named = projectsIn(request, projects)
  if (named.length === 1) return { kind: 'one', project: named[0], by: 'named' }
  // Named two or more: the later steps choose among those.
  const among = (ps: string[]) => (named.length ? ps.filter((p) => named.includes(p)) : ps)
  const shown = among(window ? projectsIn(window, projects) : [])
  if (shown.length === 1) return { kind: 'one', project: shown[0], by: 'window' }
  const lately = recent && now - recent.at <= RECENT_MS && projects.some((p) => p.name === recent.project) ? among([recent.project]) : []
  if (lately.length === 1) return { kind: 'one', project: lately[0], by: 'recent' }
  return { kind: 'ask', candidates: named.length > 1 ? named : shown }
}

/** A project as the model wrote it, by name or alias, ignoring case and accents; null when it is
 *  none of the known ones. */
export function knownProject(value: unknown, projects: JarvisProject[]): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const v = fold(value.trim())
  return projects.find((p) => terms(p).includes(v))?.name ?? null
}
