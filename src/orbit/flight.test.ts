import { sampleWorld } from '../world/sample'
import type { World } from '../world/types'
import { REPLAY, plan, targetOf, whisperOf, type FlightStage } from './flight'
import { geom, stageOf } from './layout'
import { buildScene, memoryEvents, type MemoryEvent } from './model'

const world = sampleWorld()
const at = (w: World): FlightStage => {
  const scene = buildScene(w)
  const stage = stageOf(scene, geom(1920, 1026, 14))
  return { scene, stage, core: { x: 0, y: 0 } }
}
const event = (patch: Partial<MemoryEvent>): MemoryEvent => ({ key: 'k', at: 1, kind: 'injected', slug: 'a-rule', session: null, project: null, ...patch })

describe('what flies', () => {
  const events = memoryEvents(world)

  test('the first look replays the newest events, oldest of them first', () => {
    const first = plan(null, events)
    expect(first.length).toBe(REPLAY)
    expect(first).toEqual(events.slice(-REPLAY))
    expect(plan(null, events.slice(0, 3))).toEqual(events.slice(0, 3))
  })

  test('after that only what is new does', () => {
    const seen = new Set(events.map((e) => e.key))
    expect(plan(seen, events)).toEqual([])
    const fresh = event({ key: 'fresh', at: world.at })
    expect(plan(seen, [...events, fresh])).toEqual([fresh])
  })

  test('a burst is cut to the newest, so the scene is never a queue', () => {
    const burst = Array.from({ length: 40 }, (_, i) => event({ key: `b${i}`, at: i }))
    expect(plan(new Set(), burst).map((e) => e.key)).toEqual(burst.slice(-REPLAY).map((e) => e.key))
  })
})

describe('where a mote goes', () => {
  const stage = at(world)
  const child = world.sessions.find((s) => s.title.startsWith('Webhook signature check'))!
  const parent = world.sessions.find((s) => s.id === child.parent)!

  test('a rule handed to a child flies to its family’s body', () => {
    const to = targetOf(event({ session: child.id }), stage)!
    const body = stage.stage.at.get(parent.id)!
    expect([to.x, to.y, to.body]).toEqual([body.x, body.y, parent.id])
  })

  test('a rule for a session the scene does not know flies to its project on the rim', () => {
    const to = targetOf(event({ session: 'gone', project: 'tessera' }), stage)!
    const { g } = stage.stage
    expect(to.body).toBeNull()
    expect(((to.x - g.cx) / g.rx) ** 2 + ((to.y - g.cy) / g.ry) ** 2).toBeCloseTo(0.99 ** 2, 5)
    const sector = stage.stage.sectors.find((s) => s.name === 'tessera')!
    expect(Math.atan2((to.y - g.cy) / g.ry, (to.x - g.cx) / g.rx)).toBeCloseTo(Math.atan2(Math.sin(sector.mid), Math.cos(sector.mid)), 5)
  })

  test('one with neither a session nor a project here has nowhere to fly', () => {
    expect(targetOf(event({ session: 'gone', project: 'elsewhere' }), stage)).toBeNull()
    expect(targetOf(event({}), stage)).toBeNull()
  })

  test('the words at its arrival say whether the session asked or the vault learned', () => {
    expect(whisperOf(event({ kind: 'injected' }))).toBe('a-rule')
    expect(whisperOf(event({ kind: 'read' }))).toBe('asked · a-rule')
    expect(whisperOf(event({ kind: 'learned' }))).toBe('learned · a-rule')
  })
})
