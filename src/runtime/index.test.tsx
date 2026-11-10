import { StrictMode, useEffect } from 'react'
import { runtimeStore, type Runtime } from './current'
import { canHost, focusTerminal, LiveTerminal, startRuntime, useCanHost, useHosted } from './index'
import { liveWorld } from './testing'
import { act, cleanup, render, renderHook } from './testing-dom'

// The app's wiring is not what is under test: only that it is started and stopped.
const live = vi.hoisted(() => ({ starts: 0, stops: 0 }))
vi.mock('./live', () => ({
  start() {
    live.starts++
    return () => void live.stops++
  },
}))

const session = liveWorld().sessions[0]
/** Once `./live` has loaded and whoever waited on it has run. */
const loaded = () =>
  act(async () => {
    await import('./live')
    await new Promise((r) => setTimeout(r, 50))
  })
const startedOnce = () => act(() => vi.waitFor(() => expect(live.starts).toBe(1)))

/** A runtime that hosts what `hosts` says, and says so when it changes. */
function fakeRuntime() {
  const listeners = new Set<() => void>()
  const state = { hosts: false, focused: 0 }
  const runtime: Runtime = {
    canHost: () => state.hosts,
    Terminal: ({ sessionId }) => <div data-real-terminal={sessionId} />,
    hosted: () => (state.hosts ? [{ id: 'session:3', kind: 'session', label: 'shell', cwd: '/Users/you/work', sessionId: null, pty: 3 }] : []),
    subscribe: (fn) => (listeners.add(fn), () => void listeners.delete(fn)),
    focus: () => (state.focused++, true),
  }
  return { runtime, state, tell: () => act(() => listeners.forEach((fn) => fn())) }
}

beforeEach(() => {
  live.starts = 0
  live.stops = 0
})
afterEach(() => {
  cleanup()
  act(() => runtimeStore.setState({ runtime: null }))
})

describe('before a runtime runs (the sample world, a view on its own)', () => {
  test('nothing is hosted and nothing takes the keys', () => {
    expect(canHost(session)).toBe(false)
    expect(focusTerminal()).toBe(false)
    expect(renderHook(() => useHosted()).result.current).toEqual([])
    const { container } = render(<LiveTerminal sessionId={session.id} active />)
    expect(container.querySelector('[data-live-terminal]')?.childElementCount).toBe(0)
  })
})

describe('once one runs', () => {
  test('the contract answers from it, and a view hears it change with no world change', () => {
    const f = fakeRuntime()
    const hosts = renderHook(() => useCanHost(session))
    const list = renderHook(() => useHosted())
    const { container } = render(<LiveTerminal sessionId={session.id} active />)
    act(() => runtimeStore.setState({ runtime: f.runtime }))
    expect(container.querySelector(`[data-real-terminal="${session.id}"]`)).not.toBeNull()
    expect(hosts.result.current).toBe(false)

    f.state.hosts = true
    f.tell()
    expect(canHost(session)).toBe(true)
    expect(hosts.result.current).toBe(true)
    expect(list.result.current.map((h) => h.id)).toEqual(['session:3'])
    const before = list.result.current
    f.tell()
    expect(list.result.current).toBe(before)

    expect(focusTerminal()).toBe(true)
    expect(f.state.focused).toBe(1)
  })
})

describe('starting', () => {
  test('a start under StrictMode starts it once, and its unmount stops it once', async () => {
    function Frame() {
      useEffect(() => startRuntime(), [])
      return null
    }
    const { unmount } = render(
      <StrictMode>
        <Frame />
      </StrictMode>,
    )
    await startedOnce()
    await loaded()
    expect(live).toEqual({ starts: 1, stops: 0 })
    unmount()
    expect(live).toEqual({ starts: 1, stops: 1 })
  })

  test('two starters share one runtime: only the last stop stops it', async () => {
    const first = startRuntime()
    const second = startRuntime()
    await startedOnce()
    await loaded()
    expect(live.starts).toBe(1)
    first()
    first()
    expect(live.stops).toBe(0)
    second()
    expect(live.stops).toBe(1)
  })

  test('stopped before it loaded, it never starts', async () => {
    startRuntime()()
    await loaded()
    expect(live).toEqual({ starts: 0, stops: 0 })
  })
})
