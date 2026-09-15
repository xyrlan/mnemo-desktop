import { layoutDagre } from './layout'

const n = (id: string) => ({ id, position: { x: 0, y: 0 }, data: {} })

test('LR layout puts a child to the right of its parent and keeps siblings apart', () => {
  const out = layoutDagre([n('p'), n('a'), n('b')], [{ id: 'e1', source: 'p', target: 'a' }, { id: 'e2', source: 'p', target: 'b' }])
  const by = Object.fromEntries(out.map((x) => [x.id, x.position]))
  expect(by.a.x).toBeGreaterThan(by.p.x)
  expect(by.b.x).toBeGreaterThan(by.p.x)
  expect(by.a.y).not.toBe(by.b.y)
})

test('edges to unknown nodes are ignored and data survives', () => {
  const out = layoutDagre([{ ...n('x'), data: { label: 'keep' } }], [{ id: 'e', source: 'x', target: 'ghost' }])
  expect(out[0].data).toEqual({ label: 'keep' })
  expect(Number.isFinite(out[0].position.x)).toBe(true)
})
