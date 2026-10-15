import { vi } from 'vitest'
import { openIfMissing } from './launch'
import type { ToolName, ToolStatus } from './tools'

const rows = (missing: ToolName[]): ToolStatus[] =>
  (['git', 'gh', 'claude', 'mnemo'] as ToolName[]).map((name) => ({ name, path: missing.includes(name) ? null : `/bin/${name}`, version: null, managed: false }))
const flush = () => new Promise((r) => setTimeout(r, 0))

test('setup opens once what it waits for has settled, when claude or mnemo is missing', async () => {
  let restored!: () => void
  const open = vi.fn()
  const opening = openIfMissing({ restored: new Promise<void>((r) => (restored = r)), check: async () => rows(['mnemo']), open })
  await flush()
  expect(open).not.toHaveBeenCalled()
  restored()
  expect(await opening).toBe(true)
  expect(open).toHaveBeenCalledTimes(1)
})

test('with everything present, or with only git and gh missing, setup does not open', async () => {
  for (const missing of [[], ['git', 'gh']] as ToolName[][]) {
    const open = vi.fn()
    expect(await openIfMissing({ restored: Promise.resolve(), check: async () => rows(missing), open })).toBe(false)
    expect(open).not.toHaveBeenCalled()
  }
})

test('a failed check opens nothing', async () => {
  const open = vi.fn()
  expect(await openIfMissing({ restored: Promise.resolve(), check: async () => null, open })).toBe(false)
  expect(open).not.toHaveBeenCalled()
})
