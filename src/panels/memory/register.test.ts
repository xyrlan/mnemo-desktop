// The host imports every panel while it is itself still loading: a panel's `registerPanel` at
// that moment throws. `register` must land once the host has loaded, and never spin for a host
// that does not.

const host = vi.hoisted(() => ({
  /** How many more calls find the host still loading. */
  loading: 0,
  /** What the host refuses with once loaded, if anything. */
  refuse: null as Error | null,
  got: [] as string[],
}))

vi.mock('../index', () => ({
  registerPanel: (spec: { id: string }) => {
    if (host.loading > 0) {
      host.loading--
      throw new ReferenceError("Cannot access 'registry' before initialization")
    }
    if (host.refuse) throw host.refuse
    host.got.push(spec.id)
  },
}))

import { register } from './register'

const spec = { id: 'memory' as const, title: 'Memory', Component: () => null }
const ticks = async (n: number) => {
  for (let i = 0; i < n; i++) await Promise.resolve()
}

beforeEach(() => {
  host.loading = 0
  host.refuse = null
  host.got = []
})
afterEach(() => vi.useRealTimers())

test('a host that has loaded takes the panel at once', () => {
  register(spec)
  expect(host.got).toEqual(['memory'])
})

test('a host still loading takes it once it has, without the panel module throwing', async () => {
  host.loading = 3
  expect(() => register(spec)).not.toThrow()
  expect(host.got).toEqual([])
  await ticks(5)
  expect(host.got).toEqual(['memory'])
})

test('a host that takes longer than a burst of microtasks is waited for on a timer', async () => {
  vi.useFakeTimers()
  host.loading = 205
  register(spec)
  await ticks(400)
  // 200 microtask tries are spent; nothing more happens until time passes.
  expect(host.got).toEqual([])
  expect(host.loading).toBe(4)
  await vi.advanceTimersByTimeAsync(100)
  expect(host.got).toEqual(['memory'])
})

test('a host that never loads is given up on, and said', async () => {
  vi.useFakeTimers()
  const said = vi.spyOn(console, 'error').mockImplementation(() => {})
  host.loading = Infinity
  register(spec)
  await ticks(400)
  await vi.advanceTimersByTimeAsync(5_000)
  expect(vi.getTimerCount()).toBe(0)
  expect(said).toHaveBeenCalledTimes(1)
  expect(String(said.mock.calls[0][0])).toContain('memory was not registered')
  said.mockRestore()
})

test('anything else the host throws is the panel’s to hear, not retried', () => {
  host.refuse = new TypeError('a spec without a component')
  expect(() => register(spec)).toThrow('a spec without a component')
})
