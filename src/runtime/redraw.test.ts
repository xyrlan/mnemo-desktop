import { createRedraw } from './redraw'
import { liveWorld, titled } from './testing'

const world = liveWorld()
const alpha = titled(world, 'Order status history')
const beta = titled(world, 'Dark theme contrast')

function bench() {
  const state: { staged: typeof alpha | undefined; hosts: Set<string>; again: number } = { staged: alpha, hosts: new Set(), again: 0 }
  const look = createRedraw({ staged: () => state.staged, canHost: (s) => state.hosts.has(s.id), again: () => void state.again++ })
  return { state, look }
}

test('the world is handed over again when the staged session becomes hostable with no other change', () => {
  const b = bench()
  b.look()
  expect(b.state.again).toBe(0)
  // The runtime has started: the stage was drawn before it, with a transcript.
  b.state.hosts.add(alpha.id)
  b.look()
  expect(b.state.again).toBe(1)
  // Nothing changed since: looking again hands nothing over.
  b.look()
  b.look()
  expect(b.state.again).toBe(1)
  // Its terminal was found to run nothing.
  b.state.hosts.delete(alpha.id)
  b.look()
  expect(b.state.again).toBe(2)
})

test('a session already on stage when the runtime starts is drawn again at the first look', () => {
  const b = bench()
  b.state.hosts.add(alpha.id)
  b.look()
  expect(b.state.again).toBe(1)
})

test("another session coming on stage is the route's to draw", () => {
  const b = bench()
  b.look()
  b.state.hosts.add(beta.id)
  b.state.staged = beta
  b.look()
  b.state.staged = undefined
  b.look()
  expect(b.state.again).toBe(0)
})
