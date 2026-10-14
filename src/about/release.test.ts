import { vi } from 'vitest'

const calls: { cmd: string; args?: unknown }[] = []
let answer: unknown = null
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args?: unknown) => {
    calls.push({ cmd, args })
    if (answer instanceof Error) throw answer
    return answer
  },
}))

import { newerLine, tellNewerRelease, type NewerRelease } from './release'

const R: NewerRelease = { version: '0.5.4', url: 'https://github.com/xyrlan/mnemo-desktop/releases/tag/v0.5.4', told: false }

function recorder() {
  const told: { title: string; opts: Parameters<Parameters<typeof tellNewerRelease>[0]>[1] }[] = []
  return { told, tell: (title: string, opts: (typeof told)[number]['opts']) => void told.push({ title, opts }) }
}

beforeEach(() => {
  calls.length = 0
  answer = null
})

test('a release not told about yet is said once, with its link', async () => {
  const { told, tell } = recorder()
  await tellNewerRelease(tell, async () => R)
  expect(told.map((t) => t.title)).toEqual(['mnemo 0.5.4 is out'])
  expect(told[0].opts.id).toBe('newer-release')
  told[0].opts.action.onClick()
  await Promise.resolve()
  expect(calls).toEqual([{ cmd: 'browser_open_external', args: { url: R.url } }])
})

test('a release an earlier run told about, or none, says nothing', async () => {
  const { told, tell } = recorder()
  await tellNewerRelease(tell, async () => ({ ...R, told: true }))
  await tellNewerRelease(tell, async () => null)
  expect(told).toEqual([])
})

test('the about line names a newer release whether or not it was announced', () => {
  expect(newerLine(R)).toBe('0.5.4 is out')
  expect(newerLine({ ...R, told: true })).toBe('0.5.4 is out')
  expect(newerLine(null)).toBe('')
})

test('the app is asked once per run, and an answer that is not a release is none', async () => {
  vi.resetModules()
  answer = {}
  const { newerRelease } = await import('./release')
  expect(await newerRelease()).toBeNull()
  expect(await newerRelease()).toBeNull()
  expect(calls.map((c) => c.cmd)).toEqual(['app_newer_release'])
})

test('a failed check is none, not an error', async () => {
  vi.resetModules()
  answer = new Error('Could not reach GitHub for the latest release')
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const { newerRelease } = await import('./release')
  expect(await newerRelease()).toBeNull()
  expect(warn).toHaveBeenCalled()
  warn.mockRestore()
})
