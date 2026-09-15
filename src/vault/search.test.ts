import { agentForCwd, filterTree, findPage, matches, orderAgents, pageCount, resolveWikilink } from './search'
import type { Agent, AgentKind, PageInfo } from './types'

const page = (dir: string, slug: string, over: Partial<PageInfo> = {}): PageInfo => ({
  path: `${dir}/${slug}.md`,
  slug,
  name: slug,
  description: '',
  type: 'feedback',
  confidence: null,
  topics: [],
  modified: null,
  body: '',
  ...over,
})

const agent = (name: string, kind: AgentKind, pages: PageInfo[]): Agent => {
  const types = [...new Set(pages.map((p) => p.type))]
  return { name, kind, dir: `/v/${name}`, groups: types.map((type) => ({ type, pages: pages.filter((p) => p.type === type) })) }
}

const tree: Agent[] = [
  agent('shared', 'shared', [
    page('/v/shared', 'run-tests-before-commit', { name: 'Run the full test suite', description: 'both suites', body: 'Run `pnpm test` and cargo.' }),
  ]),
  agent('mnemo', 'repo', [page('/v/mnemo', 'exploration-first', { body: 'Read before editing.' })]),
  agent('mnemo-desktop', 'repo', [
    page('/v/mnemo-desktop', 'shared-target-dir', { type: 'project', description: 'private CARGO_TARGET_DIR for parallel builds' }),
    page('/v/mnemo-desktop', 'no-silent-contract-changes', { body: 'Stop and say so.' }),
  ]),
  agent('mnemo-desktop-wt-c-vault', 'other', [page('/v/wt', 'noise')]),
]

test('search matches name, slug, description and body, every term, case-insensitive', () => {
  const p = tree[0].groups[0].pages[0]
  expect(matches(p, '')).toBe(true)
  expect(matches(p, 'FULL suite')).toBe(true)
  expect(matches(p, 'before-commit')).toBe(true)
  expect(matches(p, 'both')).toBe(true)
  expect(matches(p, 'pnpm cargo')).toBe(true)
  expect(matches(p, 'pnpm vitest')).toBe(false)
})

test('filtering drops pages, groups and agents without a match', () => {
  const hits = filterTree(tree, 'cargo')
  expect(hits.map((a) => [a.name, a.groups.map((g) => [g.type, g.pages.map((p) => p.slug)])])).toEqual([
    ['shared', [['feedback', ['run-tests-before-commit']]]],
    ['mnemo-desktop', [['project', ['shared-target-dir']]]],
  ])
  expect(filterTree(tree, '   ')).toBe(tree)
  expect(filterTree(tree, 'nothing-matches-this')).toEqual([])
  // The source tree is untouched.
  expect(pageCount(tree[2])).toBe(2)
})

test('the current repo comes first, shared second, noise apart', () => {
  const { main, other } = orderAgents(tree, 'mnemo-desktop')
  expect(main.map((a) => a.name)).toEqual(['mnemo-desktop', 'shared', 'mnemo'])
  expect(other.map((a) => a.name)).toEqual(['mnemo-desktop-wt-c-vault'])
  expect(orderAgents(tree, undefined).main.map((a) => a.name)).toEqual(['shared', 'mnemo', 'mnemo-desktop'])
  // An `other` agent never jumps the queue, even when it is the cwd's.
  expect(orderAgents(tree, 'mnemo-desktop-wt-c-vault').main[0].name).toBe('shared')
})

test('a cwd names its repo agent, worktrees and subdirectories included', () => {
  expect(agentForCwd('/Users/x/github/mnemo-desktop', tree)).toBe('mnemo-desktop')
  expect(agentForCwd('/Users/x/github/mnemo-desktop-wt-c-vault/src/vault', tree)).toBe('mnemo-desktop')
  expect(agentForCwd('/Users/x/github/mnemo/core', tree)).toBe('mnemo')
  expect(agentForCwd('/Users/x/github/elsewhere', tree)).toBeUndefined()
  expect(agentForCwd(undefined, tree)).toBeUndefined()
})

test('wikilinks resolve by slug or path, the linking agent first', () => {
  const both = [...tree, agent('mnemo-2', 'repo', [page('/v/mnemo-2', 'shared-target-dir')])]
  expect(resolveWikilink(both, 'shared-target-dir', '/v/mnemo-2')?.path).toBe('/v/mnemo-2/shared-target-dir.md')
  expect(resolveWikilink(both, 'shared-target-dir|the dir')?.path).toBe('/v/mnemo-desktop/shared-target-dir.md')
  expect(resolveWikilink(both, 'mnemo/exploration-first')?.path).toBe('/v/mnemo/exploration-first.md')
  expect(resolveWikilink(both, 'bots/x/briefings/sessions/abc')).toBeUndefined()
  expect(findPage(tree, '/v/mnemo/exploration-first.md')?.slug).toBe('exploration-first')
})
