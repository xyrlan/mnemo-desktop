import { vi } from 'vitest'

// The frame imports the host, and the host imports the panels. That order is the one that
// matters: a panel that registers at import, the plain way, then throws "Cannot access
// 'registry' before initialization" and the frame never mounts.
test('with the host imported first, as the frame does, the three work panels end up registered, in the host\'s order, Changes wide', async () => {
  const host = await import('..')
  await vi.waitFor(() => expect(host.panels().map((p) => p.id)).toEqual(expect.arrayContaining(['projects', 'missions', 'changes'])))
  const mine = host.panels().filter((p) => ['projects', 'missions', 'changes'].includes(p.id))
  expect(mine.map((p) => p.id)).toEqual(['projects', 'missions', 'changes'])
  expect(mine.map((p) => p.size ?? 'side')).toEqual(['side', 'side', 'wide'])
  for (const p of mine) expect(p.title).toBeTruthy()
})
