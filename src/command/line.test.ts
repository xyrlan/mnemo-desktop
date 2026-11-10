import { NO_ACTIONS, setActions, type Actions } from '../world/actions'
import { HOME, routeStore } from '../world/route'
import { sampleActions, sampleWorld } from '../world/sample'
import { rosterOrder } from '../world/store'
import type { World } from '../world/types'
import { complete, enter, escape, lineStore, move, openCommand, resetLine, rows, sayOutcome, type } from './line'
import { runningChildren } from './parse'

let world: World
let did: string[]
let undo: () => void

const line = () => lineStore.getState()
const route = () => routeStore.getState().route
const use = (actions: Actions) => {
  undo()
  undo = setActions(actions)
}

beforeEach(() => {
  world = sampleWorld()
  did = []
  undo = setActions(
    sampleActions(
      () => world,
      (next) => void (world = next),
      did,
    ),
  )
  routeStore.setState({ route: { ...HOME, view: 'console' }, recent: [] })
  resetLine()
  openCommand()
})
afterEach(() => undo())

describe('a batch verb is asked about before it runs', () => {
  test('Enter asks, and nothing has run; Enter again runs it', async () => {
    const crew = runningChildren(world)
    type('stop all')
    await enter(world)
    expect(did).toEqual([])
    expect(rows(line(), world)).toEqual([{ kind: 'confirm', says: expect.stringContaining('Stop 2 running children') }])
    expect(route().command).toBe(true)

    await enter(world)
    expect(did).toEqual(crew.map((s) => `stop ${s.id}`))
    expect(world.sessions.filter((s) => crew.some((c) => c.id === s.id)).map((s) => s.state)).toEqual(['ended', 'ended'])
  })

  test('Esc takes the question back, and the line stays as typed', async () => {
    type('merge green')
    await enter(world)
    expect(line().asking).not.toBeNull()
    escape()
    expect(line().asking).toBeNull()
    expect(line().text).toBe('merge green')
    expect(route().command).toBe(true)
    expect(did).toEqual([])
    // and only then does Esc close the line
    escape()
    expect(route().command).toBe(false)
  })

  test('typing again withdraws the question: Enter asks anew instead of running', async () => {
    type('stop all')
    await enter(world)
    type('stop al')
    expect(line().asking).toBeNull()
    type('stop all')
    await enter(world)
    expect(did).toEqual([])
    expect(line().asking).not.toBeNull()
  })

  test('the batch asked about is the one that runs, whatever the world became meanwhile', async () => {
    const crew = runningChildren(world)
    type('stop all')
    await enter(world)
    // a third child starts while the question is open: it was not asked about
    const more = { ...world, sessions: world.sessions.map((s) => (s.role === 'child' ? { ...s, live: true } : s)) }
    await enter(more)
    expect(did).toEqual(crew.map((s) => `stop ${s.id}`))
  })

  test('one session is not asked about', async () => {
    const child = runningChildren(world)[0]
    type(`stop ${child.short}`)
    await enter(world)
    expect(did).toEqual([`stop ${child.id}`])
  })
})

describe('taking a row', () => {
  test('Enter on a verb fills the line and runs nothing', async () => {
    type('disp')
    await enter(world)
    expect(line().text).toBe('dispatch ')
    expect(did).toEqual([])
    expect(route().command).toBe(true)
  })

  test('Tab fills the row in hand; a whole line keeps Enter for running', async () => {
    type('shell lum')
    complete(world)
    expect(line().text).toBe('shell lumen-web ')
    expect(did).toEqual([])
    expect(rows(line(), world)[0]).toEqual({ kind: 'run', says: 'Open a shell in lumen-web', batch: false })
  })

  test('a session found by part of its name is staged with one Enter, and the line closes', async () => {
    const target = rosterOrder(world).find((s) => s.title.startsWith('Why is the bundle'))!
    type('bundle')
    await enter(world)
    expect(route()).toMatchObject({ view: 'console', session: target.id, command: false })
    expect(line().text).toBe('')
  })

  test('the arrows walk the rows and wrap', () => {
    type('me')
    const n = rows(line(), world).length
    expect(n).toBeGreaterThan(2)
    move(1, world)
    expect(line().at).toBe(1)
    move(-2, world)
    expect(line().at).toBe(n - 1)
    move(1, world)
    expect(line().at).toBe(0)
  })

  test('a line that cannot run says why, and Enter does nothing', async () => {
    type('message nobody hello')
    expect(rows(line(), world)).toEqual([{ kind: 'hint', text: expect.stringContaining('No session called nobody') }])
    await enter(world)
    expect(did).toEqual([])
    expect(route().command).toBe(true)
  })

  test('a whole line is not offered again under itself', () => {
    const child = runningChildren(world)[0]
    type(`stop ${child.short}`)
    expect(rows(line(), world).map((r) => r.kind)).toEqual(['run'])
  })
})

describe('what a command comes to', () => {
  test('done: the line closes and says what was done, with the action’s own note', async () => {
    type('dispatch atlas-api #12 #14 effort=high')
    await enter(world)
    expect(did).toEqual([`dispatch ${world.projects.find((p) => p.name === 'atlas-api')!.root} 12,14`])
    expect(route().command).toBe(false)
    expect(line()).toMatchObject({ text: '', busy: false, said: { ok: true, text: 'Dispatch 2 children in atlas-api for #12 #14 (effort high) · The sample world dispatches nothing.' } })
  })

  test('the options reach the action as they were typed', async () => {
    const got: unknown[] = []
    use({ ...NO_ACTIONS, dispatch: async (root, issues, options) => (got.push({ root, issues, options }), { ok: true }), dispatchContract: async (root, path, options) => (got.push({ root, path, options }), { ok: true }) })
    type('dispatch atlas-api #12 model=opus-5.5 may=push')
    await enter(world)
    openCommand('dispatch lumen-web contracts/orders.md may=none')
    await enter(world)
    expect(got).toEqual([
      { root: world.projects.find((p) => p.name === 'atlas-api')!.root, issues: [12], options: { model: 'opus-5.5', may: 'push' } },
      { root: world.projects.find((p) => p.name === 'lumen-web')!.root, path: 'contracts/orders.md', options: { may: 'none' } },
    ])
  })

  test('refused: the line stays open as typed, and says why', async () => {
    use({ ...NO_ACTIONS, newShell: async () => ({ ok: false, why: 'That folder is gone.' }) })
    type('shell atlas-api')
    await enter(world)
    expect(route().command).toBe(true)
    expect(line()).toMatchObject({ text: 'shell atlas-api', busy: false, said: { ok: false, text: 'That folder is gone.' } })
  })

  test('an action that throws is a refusal, not a crash', async () => {
    use({
      ...NO_ACTIONS,
      mergeGreen: async () => {
        throw new Error('gh is not signed in')
      },
    })
    type('merge green')
    await enter(world)
    await enter(world)
    expect(line().said).toEqual({ ok: false, text: 'gh is not signed in' })
    expect(line().asking).toBeNull()
  })

  test('stop all reports the ones that would not stop beside the ones that did', async () => {
    const [first, second] = runningChildren(world)
    use({ ...NO_ACTIONS, stop: async (id) => (id === first.id ? { ok: true } : { ok: false, why: 'it runs on another machine' }) })
    type('stop all')
    await enter(world)
    await enter(world)
    expect(line().said).toEqual({ ok: false, text: `1 stopped. Not stopped: ${second.title}: it runs on another machine` })
  })

  test('typing the next command clears what the last one said', async () => {
    type('shell atlas-api')
    await enter(world)
    expect(line().said?.ok).toBe(true)
    openCommand()
    type('n')
    expect(line().said).toBeNull()
  })
})

describe('what was done outside the line', () => {
  test('is said where the line says what its own commands came to, and the next command clears it', () => {
    escape()
    sayOutcome('Closed', true)
    expect(line().said).toEqual({ text: 'Closed', ok: true })
    sayOutcome('It runs in another terminal.', false)
    expect(line().said).toEqual({ text: 'It runs in another terminal.', ok: false })
    // the line itself is left as it was: closed, with nothing typed
    expect(line().text).toBe('')
    expect(route().command).toBe(false)
    openCommand()
    type('n')
    expect(line().said).toBeNull()
  })
})
