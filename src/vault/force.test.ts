import { layoutForce } from './force'

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)

test('same input, same layout; every position finite', () => {
  const ids = ['a', 'b', 'c', 'd']
  const links: [string, string][] = [['a', 'b'], ['c', 'ghost']]
  const one = layoutForce(ids, links)
  expect(layoutForce(ids, links)).toEqual(one)
  expect(Object.keys(one)).toEqual(ids)
  for (const p of Object.values(one)) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true)
})

test('linked nodes end closer than unlinked ones, and nothing piles up', () => {
  const ids = Array.from({ length: 30 }, (_, i) => `n${i}`)
  // Two triangles among loose nodes.
  const links: [string, string][] = [['n0', 'n1'], ['n1', 'n2'], ['n2', 'n0'], ['n10', 'n11'], ['n11', 'n12'], ['n12', 'n10']]
  const pos = layoutForce(ids, links, { spacing: 200 })
  const linked = links.map(([a, b]) => dist(pos[a], pos[b]))
  let loose = 0
  let pairs = 0
  let nearest = Infinity
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const d = dist(pos[ids[i]], pos[ids[j]])
      nearest = Math.min(nearest, d)
      loose += d
      pairs++
    }
  expect(Math.max(...linked)).toBeLessThan(loose / pairs)
  expect(nearest).toBeGreaterThan(60)
  // Gravity keeps unlinked nodes from drifting off.
  for (const p of Object.values(pos)) expect(Math.hypot(p.x, p.y)).toBeLessThan(200 * 10)
})

test('an empty graph and a single node lay out', () => {
  expect(layoutForce([], [])).toEqual({})
  expect(layoutForce(['solo'], [['solo', 'solo']])).toEqual({ solo: { x: 0, y: 0 } })
})
