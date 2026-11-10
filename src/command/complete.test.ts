import { sampleWorld } from '../world/sample'
import { rosterOrder } from '../world/store'
import { offers } from './complete'
import { VERBS } from './parse'

const world = sampleWorld()
const fills = (line: string) => offers(line, world).map((o) => o.fill)

describe('what the line offers', () => {
  test('empty, every verb, in the order they are listed', () => {
    expect(offers('', world).map((o) => o.tag)).toEqual(VERBS.map((v) => v.verb))
  })

  test('a few letters: the verbs they start', () => {
    expect(
      offers('me', world)
        .filter((o) => o.kind === 'verb')
        .map((o) => o.fill),
    ).toEqual(['message ', 'merge '])
  })

  test('letters that are part of a session name find it, in roster order, and Enter stages it', () => {
    const found = offers('or', world).filter((o) => o.kind === 'session')
    const expected = rosterOrder(world).filter((s) => `${s.title} ${s.project} ${s.short}`.toLowerCase().includes('or'))
    expect(expected.length).toBeGreaterThan(8)
    expect(found.map((o) => o.fill)).toEqual(expected.slice(0, 8).map((s) => `go ${s.short}`))
    expect(found.every((o) => o.runs)).toBe(true)
    expect(found[0].state).toBe(expected[0].state)
  })

  test('new, shell and dispatch complete a project; only shell is whole with it', () => {
    expect(fills('dispatch lum')).toEqual(['dispatch lumen-web '])
    expect(offers('new lum', world)[0].runs).toBe(false)
    expect(offers('shell lum', world)[0]).toMatchObject({ fill: 'shell lumen-web ', runs: true })
  })

  test('dispatch completes its options, and their values from the world', () => {
    expect(fills('dispatch atlas-api #12 m')).toEqual(['dispatch atlas-api #12 model=', 'dispatch atlas-api #12 may='])
    expect(fills('dispatch atlas-api #12 may=p')).toEqual(['dispatch atlas-api #12 may=pr ', 'dispatch atlas-api #12 may=push '])
    const models = [...new Set(world.sessions.map((s) => s.model).filter(Boolean))]
    expect(models.length).toBeGreaterThan(0)
    // the models `mnemo dispatch` names, then the ones the fleet runs (`swap.test.ts` has the order)
    expect(
      offers('dispatch atlas-api #12 model=', world)
        .map((o) => o.label)
        .sort(),
    ).toEqual([...models, 'fable', 'haiku', 'opus', 'sonnet'].sort())
  })

  test('stop offers every running child first, then only sessions that are running', () => {
    const list = offers('stop ', world)
    expect(list[0]).toMatchObject({ fill: 'stop all', runs: true })
    const live = rosterOrder(world).filter((s) => s.live)
    expect(live.length).toBeLessThan(world.sessions.length)
    expect(list.slice(1).map((o) => o.fill)).toEqual(live.slice(0, 8).map((s) => `stop ${s.short}`))
  })

  test('message leaves room for the words, and is never whole on a name alone', () => {
    const list = offers('message web', world)
    expect(list.length).toBeGreaterThan(0)
    for (const o of list) {
      expect(o.fill.endsWith(' ')).toBe(true)
      expect(o.runs).toBe(false)
    }
    // once the words are being typed there is nothing left to complete
    expect(offers(`message ${rosterOrder(world)[0].short} hello th`, world)).toEqual([])
  })

  test('merge offers green, naming the pull requests it would merge', () => {
    expect(offers('merge ', world)).toMatchObject([{ fill: 'merge green', runs: true, label: expect.stringContaining('#412') }])
  })
})
