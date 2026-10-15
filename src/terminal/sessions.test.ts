import { hideFrom, type PtyInfo, type SessionClient } from './sessions'

test('the restore does not see the terminals held elsewhere, and attaches through to the core', async () => {
  const all: PtyInfo[] = [
    { id: 3, cwd: '/x', pid: 1, alive: true },
    { id: 10, cwd: '/y', pid: 2, alive: true },
  ]
  const attached: number[] = []
  const core: SessionClient = { list: async () => all, attach: async (id) => (attached.push(id), new Uint8Array()) }
  let held = [3]
  const hidden = hideFrom(core, () => held)
  expect((await hidden.list()).map((i) => i.id)).toEqual([10])
  // Asked again each time: a terminal let go is seen again.
  held = []
  expect((await hidden.list()).map((i) => i.id)).toEqual([3, 10])
  await hidden.attach(10, () => {})
  expect(attached).toEqual([10])
})
