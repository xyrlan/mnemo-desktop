import { cockpitStore } from '../../cockpit/app-store'
import { jobEnded, landArgv, outcomeOf, stopLine } from './actions'
import { child } from './fixtures'

test('a job’s outcome is its error, else the last thing it printed', () => {
  const lines = [
    { stream: 'out' as const, line: 'contract nexus-v2 (4 pieces, in landing order)' },
    { stream: 'out' as const, line: '  contract landed' },
    { stream: 'out' as const, line: '' },
  ]
  expect(outcomeOf({ title: 't', lines, running: false, code: 0 })).toEqual({ ok: true, why: 'contract landed' })
  expect(outcomeOf({ title: 't', lines, running: false, code: 1 })).toEqual({ ok: false, why: 'contract landed' })
  expect(outcomeOf({ title: 't', lines: [], running: false, code: 1 })).toEqual({ ok: false, why: 'it exited 1' })
  expect(outcomeOf({ title: 't', lines, running: false, code: 0, error: 'not merged: 1 check failed: windows' })).toEqual({ ok: false, why: 'not merged: 1 check failed: windows' })
  expect(outcomeOf(undefined)).toEqual({ ok: false, why: 'it never started' })
})

test('jobEnded waits for the job to stop running', async () => {
  const s = cockpitStore.getState()
  s.jobStart('nexus-test', 'land · nexus-v2')
  let done = false
  const ended = jobEnded('nexus-test').then((j) => ((done = true), j))
  s.jobLine('nexus-test', { stream: 'out', line: 'REHEARSAL' })
  await Promise.resolve()
  expect(done).toBe(false)
  s.jobExit('nexus-test', 0)
  expect(await ended).toMatchObject({ running: false, code: 0, lines: [{ line: 'REHEARSAL' }] })
  // One already over resolves at once.
  expect(await jobEnded('nexus-test')).toMatchObject({ code: 0 })
})

test('land lands with the repo’s own suite: mnemo’s default, or this repo’s pnpm suite', () => {
  const c = 'docs/superpowers/contracts/x.md'
  expect(landArgv('/Users/you/github/mnemo', c, 'mac')).toEqual(['mnemo', 'land', c, '--merge'])
  expect(landArgv('/Users/you/github/mnemo-desktop', c, 'mac')).toEqual([
    'mnemo', 'land', c, '--merge', '--suite',
    `sh -c 'export DEVELOPER_DIR=/Library/Developer/CommandLineTools PATH=/Library/Developer/CommandLineTools/usr/bin:"$PATH"; pnpm install --frozen-lockfile && pnpm test && pnpm build'`,
  ])
  expect(landArgv('C:\\src\\mnemo-desktop', c, 'windows').at(-1)).toBe('cmd /d /c "pnpm install --frozen-lockfile && pnpm test && pnpm build"')
})

test('a stop is claude stop on each child’s own account, one line for the shell', () => {
  const other = child('b2', { account: 'work', account_env: { config_dir: '/Users/you/.claude-work' } })
  expect(stopLine([child('a1'), other], 'posix')).toBe('claude stop a1; env CLAUDE_CONFIG_DIR=/Users/you/.claude-work claude stop b2')
  expect(stopLine([child('a1'), child('c3')], 'cmd')).toBe('claude stop a1 & claude stop c3')
})
