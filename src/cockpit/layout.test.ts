import { layoutGrouped, CARD_H, CARD_W } from './layout'
import { buildGraph } from './model'
import { withPrs } from './fixtures'

test('members sit inside their group box, relative to it; nothing overlaps at top level', () => {
  const g = buildGraph(withPrs, {})
  const out = layoutGrouped(g.nodes, g.edges)
  expect(out.map((n) => n.id).sort()).toEqual(g.nodes.map((n) => n.id).sort())
  const groups = out.filter((n) => n.type === 'group')
  expect(groups.length).toBe(2)
  for (const grp of groups) {
    const w = Number(grp.style?.width)
    const h = Number(grp.style?.height)
    const members = out.filter((n) => n.parentId === grp.id)
    expect(members.length).toBeGreaterThan(0)
    for (const m of members) {
      expect(m.position.x).toBeGreaterThanOrEqual(0)
      expect(m.position.y).toBeGreaterThanOrEqual(0)
      expect(m.position.x + CARD_W).toBeLessThanOrEqual(w)
      expect(m.position.y + CARD_H).toBeLessThanOrEqual(h)
    }
    // Groups precede their members.
    expect(out.indexOf(grp)).toBeLessThan(Math.min(...members.map((m) => out.indexOf(m))))
  }

  const abs = (id: string) => {
    const n = out.find((x) => x.id === id)!
    const p = n.parentId ? out.find((x) => x.id === n.parentId)!.position : { x: 0, y: 0 }
    return { x: n.position.x + p.x, y: n.position.y + p.y }
  }
  const cards = out.filter((n) => n.type !== 'group').map((n) => ({ id: n.id, ...abs(n.id) }))
  for (const a of cards)
    for (const b of cards) {
      if (a.id >= b.id) continue
      const apart = Math.abs(a.x - b.x) >= CARD_W || Math.abs(a.y - b.y) >= CARD_H
      expect(apart, `${a.id} overlaps ${b.id}`).toBe(true)
    }
  // LR: a child is right of its repo.
  expect(abs('child:c0ffee01').x).toBeGreaterThan(abs('repo:/Users/me/github/mnemo').x)
})

test('a group with no members is dropped', () => {
  const out = layoutGrouped([{ id: 'g', type: 'group', position: { x: 0, y: 0 }, data: {} }, { id: 'a', type: 'card', position: { x: 0, y: 0 }, data: {} }], [])
  expect(out.map((n) => n.id)).toEqual(['a'])
})
