/** A project the composer offers: a repo from the fleet. */
export type ProjectOption = {
  /** The repo's main-checkout root: what `createWorktree` takes. */
  id: string
  displayName: string
  /** The path shown beside the name. */
  detail: string
  /** The branch the main checkout is on: the base a new branch starts from by default. */
  mainBranch: string | null
  /** Branch and tree names already in use, which a default name avoids. */
  taken: string[]
}

export type ProjectMatch = { option: ProjectOption; nameHits: number[]; detailHits: number[]; score: number }

/** Where `query` falls in `text`, case-insensitively: a substring first (every offset of it,
 *  scored by how early it starts), else the characters in order (scored lower); null when it
 *  is not there at all. An empty query hits nothing and scores 0. */
export function matchText(text: string, query: string): { hits: number[]; score: number } | null {
  const q = query.trim().toLowerCase()
  if (!q) return { hits: [], score: 0 }
  const t = text.toLowerCase()
  const at = t.indexOf(q)
  if (at >= 0) return { hits: Array.from({ length: q.length }, (_, i) => at + i), score: 1000 - at }
  const hits: number[] = []
  let from = 0
  for (const ch of q) {
    const i = t.indexOf(ch, from)
    if (i < 0) return null
    hits.push(i)
    from = i + 1
  }
  return { hits, score: 100 - (hits[hits.length - 1] - hits[0]) }
}

/** The projects `query` matches, best first: a name hit beats a path hit, and an empty query keeps
 *  the fleet's order. */
export function rankProjects(options: readonly ProjectOption[], query: string): ProjectMatch[] {
  if (!query.trim()) return options.map((option) => ({ option, nameHits: [], detailHits: [], score: 0 }))
  const out: ProjectMatch[] = []
  for (const option of options) {
    const name = matchText(option.displayName, query)
    const detail = name ? null : matchText(option.detail, query)
    if (name) out.push({ option, nameHits: name.hits, detailHits: [], score: 10_000 + name.score })
    else if (detail) out.push({ option, nameHits: [], detailHits: detail.hits, score: detail.score })
  }
  return out.sort((a, b) => b.score - a.score)
}

/** A path split so its last two segments survive when space runs out: `~/dev/…/services/api`
 *  stays apart from `…/services/web`. Null when the path has no more than two segments. */
export function splitPathHead(path: string): { head: string; tail: string } | null {
  const parts = path.split(/(?<=[\\/])/)
  if (parts.length <= 2) return null
  const tail = parts.slice(-2).join('')
  return { head: path.slice(0, path.length - tail.length), tail }
}
