import type { Ship } from '../ship-types'
import { menuFor, registerMenu, type MenuItem } from './menus'

const ship = {} as Ship
const ctx = { open: () => {} }
const item = (id: string): MenuItem => ({ id, label: id, run: () => {} })

test('a provider gets the context the Nexus lends', () => {
  const opened: string[] = []
  const off = registerMenu((t, _s, c) => [{ id: 'open', label: 'Open', run: () => c.open(t.id) }])
  menuFor({ kind: 'robot', id: '408' }, ship, { open: (id) => void opened.push(id) })[0].run()
  expect(opened).toEqual(['408'])
  off()
})

test('every provider offers its items for a target, in registration order; one that throws offers none', () => {
  const offs = [
    registerMenu((t) => (t.kind === 'captain' ? [item('a')] : [])),
    registerMenu(() => {
      throw new Error('boom')
    }),
    registerMenu((t) => (t.kind === 'captain' ? [item('b')] : [item('deck')])),
  ]
  expect(menuFor({ kind: 'captain', id: 'c1' }, ship, ctx).map((i) => i.id)).toEqual(['a', 'b'])
  expect(menuFor({ kind: 'deck', id: '/r' }, ship, ctx).map((i) => i.id)).toEqual(['deck'])
  offs[0]()
  expect(menuFor({ kind: 'captain', id: 'c1' }, ship, ctx).map((i) => i.id)).toEqual(['b'])
  for (const off of offs) off()
  expect(menuFor({ kind: 'captain', id: 'c1' }, ship, ctx)).toEqual([])
})
