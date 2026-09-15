import { buildGraph, nodeId } from './model'
import { snapshot, desktop } from '../mission/fixtures'
import { withPrs, shipped } from './fixtures'
import type { CardData } from '../graph'

const data = (g: ReturnType<typeof buildGraph>, id: string) => g.nodes.find((n) => n.id === id)?.data as CardData | undefined
const has = (g: ReturnType<typeof buildGraph>, s: string, t: string) => g.edges.some((e) => e.source === s && e.target === t)

test('repo → parent → mission group → children, with tone, pulse and token badges', () => {
  const g = buildGraph(snapshot, { a43d3832: 1 }, desktop.root)
  const repo = 'repo:/Users/me/github/mnemo-desktop'
  const parent = 'parent:0ff9d810-aaaa'
  const head = `mission:${desktop.missions[0].contract_path}`
  expect(has(g, repo, parent)).toBe(true)
  // The mission hangs off the parent that dispatched its children, not off the repo.
  expect(has(g, parent, head)).toBe(true)
  expect(has(g, repo, head)).toBe(false)
  expect(has(g, head, 'child:a43d3832')).toBe(true)
  expect(has(g, head, 'child:094c6a03')).toBe(true)

  expect(data(g, repo)).toMatchObject({ label: 'mnemo-desktop', tone: 'accent', sub: '2 live · 1 parent' })
  expect(data(g, parent)).toMatchObject({ label: 'round3 dispatch', badge: '210k', tone: 'accent' })
  expect(data(g, parent)?.sub).toContain('children 640k')
  expect(data(g, 'child:a43d3832')).toMatchObject({ label: 'cockpit', tone: 'accent', badge: '+3 · 320k', sub: 'writing the cockpit pane' })
  expect(data(g, 'child:094c6a03')).toMatchObject({ label: 'vault', tone: 'bad', pulse: true, sub: 'may I add a crate?' })
  // Unfocused repo is muted; a child with no dispatcher hangs off its repo.
  expect(data(g, 'repo:/Users/me/github/mnemo')?.tone).toBe('muted')
  expect(has(g, 'repo:/Users/me/github/mnemo', 'child:c0ffee01')).toBe(true)
})

test('pieces live inside their contract group, and the group comes first', () => {
  const g = buildGraph(snapshot, {})
  const group = nodeId.group(desktop.missions[0])
  const gi = g.nodes.findIndex((n) => n.id === group)
  expect(g.nodes[gi].type).toBe('group')
  for (const id of [`mission:${desktop.missions[0].contract_path}`, 'child:a43d3832', 'child:094c6a03']) {
    const i = g.nodes.findIndex((n) => n.id === id)
    expect(g.nodes[i].parentId).toBe(group)
    expect(i).toBeGreaterThan(gi)
  }
  expect(g.nodes.find((n) => n.id === 'child:c0ffee01')?.parentId).toBeUndefined()
})

test('child → PR → CI with CI tone; a PR without child hangs off the mission; landable contract is ok', () => {
  const g = buildGraph(withPrs, {})
  const m = shipped.missions[0]
  const head = nodeId.mission(m)
  const pr12 = 'pr:/Users/me/github/mnemo#12'
  const pr13 = 'pr:/Users/me/github/mnemo#13'
  expect(has(g, 'child:beef0001', pr12)).toBe(true)
  expect(has(g, pr12, 'ci:/Users/me/github/mnemo#12')).toBe(true)
  expect(has(g, head, pr13)).toBe(true)
  expect(data(g, pr12)?.tone).toBe('ok')
  expect(data(g, pr13)?.tone).toBe('bad')
  expect(data(g, 'ci:/Users/me/github/mnemo#13')).toMatchObject({ tone: 'bad', sub: 'fail' })
  expect(data(g, 'child:beef0001')?.tone).toBe('ok')
  expect(data(g, head)).toMatchObject({ tone: 'ok', sub: '2/3 PR · CI ✗ · land: ready' })
  expect(data(g, nodeId.piece(m, 'later'))).toMatchObject({ label: 'later', sub: 'no child, no PR' })

  expect(g.targets['child:beef0001']).toMatchObject({ kind: 'child' })
  expect(g.targets[pr13]).toMatchObject({ kind: 'pr', pr: { number: 13 } })
  expect(g.targets[head]).toMatchObject({ kind: 'mission' })
  expect(g.targets['repo:/Users/me/github/mnemo']).toBeUndefined()
})

test('every edge joins two nodes and ids are unique', () => {
  const g = buildGraph(withPrs, {})
  const ids = g.nodes.map((n) => n.id)
  expect(new Set(ids).size).toBe(ids.length)
  for (const e of g.edges) {
    expect(ids).toContain(e.source)
    expect(ids).toContain(e.target)
  }
  expect(buildGraph({ repos: [], errors: [], at: '' }, {})).toEqual({ nodes: [], edges: [], targets: {} })
})

test('issues are roots: a dispatched child hangs off its issue, pieces and PRs are linked, the rest are recent roots', async () => {
  const { snapWithIssues, mnemoIssues } = await import('../github/fixtures')
  const root = '/Users/me/github/mnemo'
  const g = buildGraph(snapWithIssues, {}, undefined, { issues: { [root]: mnemoIssues }, labels: {} })
  const issue = (n: number) => `issue:${root}#${n}`
  const repo = `repo:${root}`

  // #40: its child moves from the repo to the issue.
  expect(has(g, issue(40), 'child:c0ffee01')).toBe(true)
  expect(has(g, repo, 'child:c0ffee01')).toBe(false)
  // #41 names the api piece: linked to its child (inside the group), not to that child's PR.
  expect(has(g, issue(41), 'child:beef0001')).toBe(true)
  expect(has(g, issue(41), `pr:${root}#12`)).toBe(false)
  // #42 is closed by the docs PR, which has no child.
  expect(has(g, issue(42), `pr:${root}#13`)).toBe(true)
  expect(data(g, issue(42))).toMatchObject({ label: '#42 closed by the docs PR', badge: 'PR #13 CI ✗', tone: 'accent' })
  expect(data(g, issue(43))?.badge).toBe('PR #99')

  // Issues have no incoming edge.
  for (const n of g.nodes.filter((x) => x.id.startsWith('issue:'))) expect(g.edges.some((e) => e.target === n.id)).toBe(false)
  expect(g.nodes.filter((n) => n.id.startsWith('issue:')).length).toBe(14)
  expect(data(g, issue(12))).toMatchObject({ tone: 'muted', sub: 'ui · @me' })
  expect(data(g, issue(1))).toBeUndefined() // the 11th most recent unlinked one
  expect(g.targets[issue(12)]).toMatchObject({ kind: 'issue', root, issue: { number: 12 } })

  const ids = g.nodes.map((n) => n.id)
  expect(new Set(ids).size).toBe(ids.length)
  for (const e of g.edges) expect(ids).toContain(e.source)
  for (const e of g.edges) expect(ids).toContain(e.target)
})

test('the label filter narrows only the recent issues; other repos and no input change nothing', async () => {
  const { snapWithIssues, mnemoIssues } = await import('../github/fixtures')
  const root = '/Users/me/github/mnemo'
  const g = buildGraph(snapWithIssues, {}, undefined, { issues: { [root]: mnemoIssues }, labels: { [root]: ['ui'] } })
  const shown = g.nodes.filter((n) => n.id.startsWith('issue:')).map((n) => Number(n.id.split('#')[1]))
  expect(shown).toEqual([43, 42, 41, 40, 12, 10, 8, 6, 4, 2])
  expect(buildGraph(withPrs, {}, undefined, { issues: {}, labels: {} })).toEqual(buildGraph(withPrs, {}))
})
