import { makeWebviews } from './lifecycle'

function setup() {
  const calls: string[] = []
  const client = {
    create: async (id: number, url: string) => void calls.push(`create ${id} ${url}`),
    setBounds: async (id: number, b: { w: number }) => void calls.push(`bounds ${id} ${b.w}`),
    destroy: async (id: number) => void calls.push(`destroy ${id}`),
  }
  const queue = new Map<number, () => void>()
  let next = 0
  const timers = {
    set: (f: () => void) => {
      queue.set(++next, f)
      return next
    },
    clear: (t: unknown) => void queue.delete(t as number),
  }
  const flush = () => {
    for (const [k, f] of [...queue]) {
      queue.delete(k)
      f()
    }
  }
  return { calls, flush, w: makeWebviews(client, 250, timers) }
}

const b = { x: 0, y: 0, w: 100, h: 100 }

test('a remount inside the grace period reuses the webview', async () => {
  const { calls, flush, w } = setup()
  await w.acquire(-1, 'https://x.dev/', b)
  w.remember(-1, 'https://x.dev/next')
  w.release(-1)
  await w.acquire(-1, 'https://x.dev/', b)
  flush()
  expect(calls).toEqual(['create -1 https://x.dev/', 'bounds -1 0', 'bounds -1 100'])
  expect(w.url(-1)).toBe('https://x.dev/next')
})

test('a pane that stays gone is destroyed and forgotten', async () => {
  const { calls, flush, w } = setup()
  await w.acquire(-1, 'https://x.dev/', b)
  w.release(-1)
  flush()
  expect(calls).toEqual(['create -1 https://x.dev/', 'bounds -1 0', 'destroy -1'])
  expect(w.url(-1)).toBeUndefined()
  await w.acquire(-1, 'https://x.dev/', b)
  expect(calls.at(-1)).toBe('create -1 https://x.dev/')
})
