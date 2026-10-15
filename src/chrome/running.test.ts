import { beforeEach, expect, it, vi } from 'vitest'

const calls: { cmd: string; args: unknown }[] = []
let answer: (cmd: string) => unknown = () => null
// A plain recorder: a Tauri refusal is a string, not an Error.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args: unknown) => {
    calls.push({ cmd, args })
    return new Promise((resolve) => resolve(answer(cmd)))
  },
}))

import { paneRuns, paneRunsClaude } from './running'

beforeEach(() => {
  calls.length = 0
})

it('asks about the shell of the pane', async () => {
  answer = (cmd) => (cmd === 'pty_pid' ? 4321 : true)
  await expect(paneRunsClaude(3)).resolves.toBe(true)
  expect(calls).toEqual([
    { cmd: 'pty_pid', args: { id: 3 } },
    { cmd: 'chrome_claude_running', args: { panePid: 4321 } },
  ])
  answer = (cmd) => (cmd === 'pty_pid' ? 4321 : false)
  await expect(paneRunsClaude(3)).resolves.toBe(false)
})

it('a pane whose shell has exited runs nothing', async () => {
  answer = () => null
  await expect(paneRunsClaude(3)).resolves.toBe(false)
  answer = () => Promise.reject('no such pane')
  await expect(paneRunsClaude(3)).resolves.toBe(false)
  expect(calls.map((c) => c.cmd)).toEqual(['pty_pid', 'pty_pid'])
})

it('says it cannot tell when the process tree could not be walked, not that Claude left', async () => {
  answer = (cmd) => (cmd === 'pty_pid' ? 4321 : Promise.reject('the process table could not be read: CreateToolhelp32Snapshot: Access is denied.'))
  const said = await paneRunsClaude(3).then(
    () => 'answered',
    (e: unknown) => e,
  )
  expect(said).toBeInstanceOf(Error)
  expect((said as Error).message).toBe(
    'Cannot tell whether Claude is running in that terminal (the process table could not be read: CreateToolhelp32Snapshot: Access is denied.): nothing was sent',
  )
  expect((said as Error).message).not.toMatch(/no longer running/)
})

it('says what runs in a pane: the shell at its prompt, a Claude, something else, or that nobody can tell (#460)', async () => {
  for (const runs of ['idle', 'claude', 'other', 'unknown']) {
    answer = (cmd) => (cmd === 'pty_pid' ? 4321 : runs)
    await expect(paneRuns(3)).resolves.toBe(runs)
  }
  expect(calls.slice(0, 2)).toEqual([
    { cmd: 'pty_pid', args: { id: 3 } },
    { cmd: 'chrome_pane_runs', args: { panePid: 4321 } },
  ])
  // A shell that has exited runs nothing; one whose pid or table could not be read, nobody can say.
  answer = () => null
  await expect(paneRuns(3)).resolves.toBe('idle')
  answer = () => Promise.reject('no such pane')
  await expect(paneRuns(3)).resolves.toBe('unknown')
  answer = (cmd) => (cmd === 'pty_pid' ? 4321 : Promise.reject('the process table could not be read'))
  await expect(paneRuns(3)).resolves.toBe('unknown')
})
