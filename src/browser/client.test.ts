import { makeBrowserClient, pageBounds, sameBounds, type Invoke } from './client'

function deferred() {
  let resolve!: () => void
  let reject!: (e: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function fakeInvoke() {
  const calls: { cmd: string; args?: Record<string, unknown> }[] = []
  const gates: Record<string, ReturnType<typeof deferred>> = {}
  const invoke = (async (cmd: string, args?: Record<string, unknown>) => {
    calls.push({ cmd, args })
    await gates[cmd]?.promise
  }) as Invoke
  return { invoke, calls, gates }
}

const listen = async () => () => {}
const b = { x: 1, y: 2, w: 3, h: 4 }

test('calls for one pane run in order even when create is slow', async () => {
  const f = fakeInvoke()
  f.gates.browser_create = deferred()
  const c = makeBrowserClient(f.invoke, listen)
  const created = c.create(-1, 'https://x.dev/', b)
  const bounded = c.setBounds(-1, b)
  const destroyed = c.destroy(-1)
  await Promise.resolve()
  expect(f.calls.map((x) => x.cmd)).toEqual(['browser_create'])
  f.gates.browser_create.resolve()
  await Promise.all([created, bounded, destroyed])
  expect(f.calls.map((x) => x.cmd)).toEqual(['browser_create', 'browser_set_bounds', 'browser_destroy'])
})

test('a failed call does not block the ones queued behind it', async () => {
  const f = fakeInvoke()
  f.gates.browser_create = deferred()
  const c = makeBrowserClient(f.invoke, listen)
  const created = c.create(-1, 'https://x.dev/', b)
  const destroyed = c.destroy(-1)
  f.gates.browser_create.reject('boom')
  await expect(created).rejects.toBe('boom')
  await destroyed
  expect(f.calls.map((x) => x.cmd)).toEqual(['browser_create', 'browser_destroy'])
})

test('panes do not wait on each other', async () => {
  const f = fakeInvoke()
  f.gates.browser_create = deferred()
  const c = makeBrowserClient(f.invoke, listen)
  void c.create(-1, 'https://x.dev/', b)
  await c.setBounds(-2, b)
  expect(f.calls.map((x) => [x.cmd, x.args?.id])).toEqual([
    ['browser_create', -1],
    ['browser_set_bounds', -2],
  ])
  f.gates.browser_create.resolve()
})

test('arguments match the Rust command signatures', async () => {
  const f = fakeInvoke()
  const c = makeBrowserClient(f.invoke, listen)
  await c.create(-3, 'https://x.dev/', b)
  await c.navigate(-3, 'https://y.dev/')
  await c.prUrl()
  expect(f.calls).toEqual([
    { cmd: 'browser_create', args: { id: -3, url: 'https://x.dev/', x: 1, y: 2, w: 3, h: 4 } },
    { cmd: 'browser_navigate', args: { id: -3, url: 'https://y.dev/' } },
    { cmd: 'browser_pr_url', args: { cwd: null } },
  ])
})

test('page bounds round to pixels and collapse when hidden', () => {
  const rect = { left: 10.4, top: 40.6, width: 300.5, height: 200.2 }
  expect(pageBounds(rect, true)).toEqual({ x: 10, y: 41, w: 301, h: 200 })
  expect(pageBounds(rect, false)).toEqual({ x: 0, y: 0, w: 0, h: 0 })
  expect(pageBounds({ left: 5, top: 5, width: 0, height: 0 }, true)).toEqual({ x: 0, y: 0, w: 0, h: 0 })
  expect(sameBounds(null, b)).toBe(false)
  expect(sameBounds({ ...b }, b)).toBe(true)
})
