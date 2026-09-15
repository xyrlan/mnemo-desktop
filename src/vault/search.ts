import type { Agent, PageInfo } from './types'

const segments = (cwd: string) => cwd.split('/').filter(Boolean)

/** The agent a working directory belongs to: the deepest path segment that names a repo
 *  agent, trying a worktree's repo (`mnemo-desktop-wt-x` → `mnemo-desktop`) too. */
export function agentForCwd(cwd: string | undefined, agents: Pick<Agent, 'name' | 'kind'>[]): string | undefined {
  if (!cwd) return undefined
  const repos = new Set(agents.filter((a) => a.kind === 'repo').map((a) => a.name))
  for (const seg of segments(cwd).reverse()) {
    const base = seg.replace(/-wt-.*$/, '')
    if (repos.has(seg)) return seg
    if (repos.has(base)) return base
  }
  return undefined
}

/** The current repo's agent first, `shared` second, then the other repos; `other` agents
 *  (test runs, worktrees) come back separately so the tree can fold them. */
export function orderAgents(agents: Agent[], current: string | undefined): { main: Agent[]; other: Agent[] } {
  const rank = (a: Agent) => (a.name === current ? 0 : a.kind === 'shared' ? 1 : 2)
  const main = agents.filter((a) => a.kind !== 'other').sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
  return { main, other: agents.filter((a) => a.kind === 'other') }
}

export const terms = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean)

/** Every term appears in the name, slug, description or body. */
export function matches(page: PageInfo, query: string): boolean {
  const t = terms(query)
  if (t.length === 0) return true
  const hay = `${page.name}\n${page.slug}\n${page.description}\n${page.body}`.toLowerCase()
  return t.every((x) => hay.includes(x))
}

/** The tree narrowed to matching pages; agents and groups left empty drop out. */
export function filterTree(agents: Agent[], query: string): Agent[] {
  if (terms(query).length === 0) return agents
  return agents
    .map((a) => ({
      ...a,
      groups: a.groups.map((g) => ({ ...g, pages: g.pages.filter((p) => matches(p, query)) })).filter((g) => g.pages.length > 0),
    }))
    .filter((a) => a.groups.length > 0)
}

export const pageCount = (a: Agent) => a.groups.reduce((n, g) => n + g.pages.length, 0)

export function findPage(agents: Agent[], path: string): PageInfo | undefined {
  for (const a of agents) for (const g of a.groups) for (const p of g.pages) if (p.path === path) return p
  return undefined
}

/** `[[shared-target-dir]]` or `[[bots/x/memory/shared-target-dir]]` → that page, the
 *  given agent's own first. */
export function resolveWikilink(agents: Agent[], target: string, preferAgentDir?: string): PageInfo | undefined {
  const t = target.split('|')[0].trim().replace(/\.md$/, '')
  const last = t.split('/').pop() ?? t
  const all = agents.flatMap((a) => a.groups.flatMap((g) => g.pages))
  const hit = (p: PageInfo) => p.path.endsWith(`/${t}.md`) || p.slug === last || p.path.endsWith(`/${last}.md`)
  return all.find((p) => hit(p) && !!preferAgentDir && p.path.startsWith(preferAgentDir + '/')) ?? all.find(hit)
}
