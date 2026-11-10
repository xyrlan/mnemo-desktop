import { sessionOf } from '../store'
import type { World } from '../types'
import { fakeSources, parent, PARENT, repo, snapshotOf } from './fixtures'
import { startLive } from './index'

// `startLive` on sources a test holds: the app's own (`./sources.ts`) are Tauri's.
const fake = vi.hoisted(() => ({ current: null as ReturnType<typeof import('./fixtures').fakeSources> | null, loads: 0 }))
vi.mock('./sources', () => ({
  appSources: () => {
    fake.loads++
    return fake.current!.sources
  },
}))

type Hook = { world(): World | null; compare(capture?: unknown): Promise<string> }
const hook = () => (globalThis as { __mnemoWorld?: Hook }).__mnemoWorld
/** Lets the sources load and the first read finish. */
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
}

beforeEach(() => {
  fake.current = fakeSources(snapshotOf([repo({ parents: [parent({ status: 'busy' })] })]))
  fake.loads = 0
})

describe('startLive', () => {
  test('hands over this machine’s world, and each new one after it', async () => {
    const worlds: World[] = []
    const stop = startLive((w) => worlds.push(w))
    await settle()
    expect(worlds).toHaveLength(1)
    expect(worlds[0].source).toBe('live')
    expect(sessionOf(worlds[0], PARENT)!.state).toBe('working')

    fake.current!.mission.set(snapshotOf([repo({ parents: [parent({ status: 'idle' })] })]))
    await settle()
    expect(worlds).toHaveLength(2)
    expect(sessionOf(worlds[1], PARENT)!.state).toBe('idle')
    stop()
  })

  test('stopped, it hands over nothing more and listens to nothing', async () => {
    const worlds: World[] = []
    const stop = startLive((w) => worlds.push(w))
    await settle()
    expect(fake.current!.state.subscribed).toBe(6)
    stop()
    expect(fake.current!.state.subscribed).toBe(0)
    fake.current!.mission.set(snapshotOf([repo({ parents: [parent({ status: 'idle' })] })]))
    await settle()
    expect(worlds).toHaveLength(1)
  })

  test('stopped before its sources loaded, it never starts', async () => {
    const worlds: World[] = []
    startLive((w) => worlds.push(w))()
    await settle()
    expect(worlds).toEqual([])
    expect(fake.loads).toBe(0)
    expect(fake.current!.state.subscribed).toBe(0)
  })

  test('the world last handed over can be asked for, and held against a capture', async () => {
    expect(hook()).toBeUndefined()
    const worlds: World[] = []
    const stop = startLive((w) => worlds.push(w))
    expect(hook()!.world()).toBeNull()
    expect(await hook()!.compare({})).toBe('No live world yet.')
    await settle()
    expect(hook()!.world()).toBe(worlds[0])

    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const text = await hook()!.compare({ capturedAt: new Date(worlds[0].at).toISOString(), sessions: [], pending: [], accounts: [], projects: [], vault: {} })
    log.mockRestore()
    expect(text).toContain('live world against capture: 0 sessions in both')
    expect(text).toContain(`${PARENT.slice(0, 8)}  capture absent -> live parent, working`)

    stop()
    expect(hook()).toBeUndefined()
  })
})
