import { buildMissionMap, mapId, CARD_H, CARD_W, type MapCard } from './model'
import { desktop } from '../mission/fixtures'
import { shipped } from './fixtures'
import { mnemoIssues } from '../github/fixtures'

type M = ReturnType<typeof buildMissionMap>
const data = (g: M, id: string) => g.nodes.find((n) => n.id === id)?.data as MapCard | undefined
const has = (g: M, s: string, t: string) => g.edges.some((e) => e.source === s && e.target === t)
const kinds = (g: M, id: string) => data(g, id)?.actions.map((a) => a.kind)

test('contract → pieces → PR → land, with child state, CI and the actions each card offers', () => {
  const m = shipped.missions[0]
  const g = buildMissionMap(shipped, m, {})
  const head = mapId.mission(m)
  const api = mapId.piece(m, 'api')
  const docs = mapId.piece(m, 'docs')
  const later = mapId.piece(m, 'later')
  const pr12 = mapId.pr(shipped, m.pieces[0].pr!)
  const pr13 = mapId.pr(shipped, m.pieces[1].pr!)
  const land = mapId.land(m)

  for (const p of [api, docs, later]) expect(has(g, head, p)).toBe(true)
  expect(has(g, api, pr12)).toBe(true)
  expect(has(g, docs, pr13)).toBe(true)
  expect(has(g, pr12, land) && has(g, pr13, land)).toBe(true)
  expect(g.nodes.map((n) => n.id).sort()).toEqual([head, api, docs, later, pr12, pr13, land].sort())

  expect(data(g, head)).toMatchObject({ label: 'mission round4', sub: '2/3 PR · CI ✗', tone: 'ok' })
  expect(kinds(g, head)).toEqual(['contract'])
  expect(data(g, api)).toMatchObject({ label: 'api', tone: 'ok' })
  expect(kinds(g, api)).toEqual(['open'])
  expect(data(g, later)).toMatchObject({ sub: 'no child, no PR', tone: 'muted' })
  expect(data(g, pr13)).toMatchObject({ label: 'PR #13', sub: 'open · CI ✗ fail', tone: 'bad' })
  expect(kinds(g, pr13)).toEqual(['pr', 'job'])
  // Landable: the green PR merges through land, not on its own.
  expect(kinds(g, pr12)).toEqual(['pr'])
  expect(data(g, land)).toMatchObject({ tone: 'ok' })
  expect(kinds(g, land)).toEqual(['land'])
})

test('BLOCKED pulses and offers reply, a working edge animates, a ready PR offers merge', () => {
  const m = {
    ...desktop.missions[0],
    pieces: desktop.missions[0].pieces.map((p) => (p.name === 'cockpit' ? { ...p, pr: { number: 7, url: 'u', state: 'OPEN', head: p.branch, ci: 'pass' as const } } : p)),
  }
  const g = buildMissionMap(desktop, m, { a43d3832: 1 })
  const vault = mapId.piece(m, 'vault')
  const cockpit = mapId.piece(m, 'cockpit')
  expect(data(g, vault)).toMatchObject({ pulse: true, tone: 'bad', sub: 'may I add a crate?', badge: 'BLOCKED' })
  expect(kinds(g, vault)).toEqual(['reply', 'attach'])
  expect(data(g, cockpit)).toMatchObject({ badge: '+3 · 320k', sub: 'writing the cockpit pane' })
  expect(kinds(g, cockpit)).toEqual(['attach', 'open'])
  expect(g.edges.find((e) => e.target === cockpit)?.animated).toBe(true)
  expect(g.edges.find((e) => e.target === vault)?.animated).toBeUndefined()
  expect(kinds(g, mapId.pr(desktop, m.pieces[0].pr!))).toEqual(['pr', 'merge'])
  expect(kinds(g, mapId.land(m))).toEqual([])
})

test('issues that feed the mission are roots on its map; the others are not drawn', () => {
  const m = shipped.missions[0]
  const g = buildMissionMap(shipped, m, {}, mnemoIssues)
  const issues = g.nodes.filter((n) => n.id.startsWith('issue:')).map((n) => n.id)
  // #41 names the api piece; #42 is closed by the docs PR; #40 is a loose child's, #43 a PR the mission lacks.
  expect(issues.sort()).toEqual([mapId.issue(shipped, 41), mapId.issue(shipped, 42)].sort())
  expect(has(g, mapId.issue(shipped, 41), mapId.piece(m, 'api'))).toBe(true)
  // A closing PR with no piece naming the issue: the issue points at the PR itself.
  expect(has(g, mapId.issue(shipped, 42), mapId.pr(shipped, m.pieces[1].pr!))).toBe(true)
  expect(kinds(g, mapId.issue(shipped, 41))).toEqual(['issue'])
  for (const id of issues) expect(g.edges.some((e) => e.target === id)).toBe(false)
})

test('laid out left to right at card size, no two cards overlapping, every edge between drawn cards', () => {
  const m = shipped.missions[0]
  const g = buildMissionMap(shipped, m, {}, mnemoIssues)
  const ids = g.nodes.map((n) => n.id)
  expect(new Set(ids).size).toBe(ids.length)
  for (const e of g.edges) expect(ids).toContain(e.source)
  for (const e of g.edges) expect(ids).toContain(e.target)
  const pos = (id: string) => g.nodes.find((n) => n.id === id)!.position
  expect(pos(mapId.land(m)).x).toBeGreaterThan(pos(mapId.pr(shipped, m.pieces[0].pr!)).x)
  expect(pos(mapId.piece(m, 'api')).x).toBeGreaterThan(pos(mapId.mission(m)).x)
  for (const a of g.nodes)
    for (const b of g.nodes) {
      if (a.id >= b.id) continue
      const apart = Math.abs(a.position.x - b.position.x) >= CARD_W || Math.abs(a.position.y - b.position.y) >= CARD_H
      expect(apart, `${a.id} overlaps ${b.id}`).toBe(true)
    }
})
