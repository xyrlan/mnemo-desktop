// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onTestFailed, vi } from 'vitest'
import { thenLeave, withEnv } from '../src/pty/typed.ts'

/** The lines `src/pty/typed.ts` writes for cmd and PowerShell, run by the real shells (#331). Nobody has
 *  a Windows machine here: CI's `windows-latest` job is where these run, and everywhere else they
 *  are skipped. Each shell reads the line from its standard input, as it reads a typed one, with a
 *  stand-in `claude` first on `PATH` that records its arguments and the `CLAUDE_CONFIG_DIR` it was
 *  started with. A second line, `claude after`, says what the shell was left like. */

const windows = process.platform === 'win32'
// A shell is started for every line, and PowerShell takes seconds to start on a busy runner.
vi.setConfig({ testTimeout: 180_000 })
const VAR = 'CLAUDE_CONFIG_DIR'
/** What the shell itself starts with: the pane's own account. */
const PANE_DIR = 'C:\\pane-account'

/** The stand-in's calls, in order: `{ args, dir }` each. */
function run(shell, line, paneDir = PANE_DIR) {
  const root = mkdtempSync(join(tmpdir(), 'mnemo typed '))
  try {
    const bin = join(root, 'bin')
    mkdirSync(bin)
    const out = join(root, 'calls.jsonl')
    writeFileSync(
      join(bin, 'claude.js'),
      `require('node:fs').appendFileSync(process.env.MNEMO_TYPED_OUT, JSON.stringify({ args: process.argv.slice(2), dir: process.env.${VAR} ?? null }) + '\\n')\n`,
    )
    writeFileSync(join(bin, 'claude.cmd'), `@"${process.execPath}" "%~dp0claude.js" %*\r\n`)
    const env = { ...process.env, MNEMO_TYPED_OUT: out }
    // Windows' own directories and nothing else: a CI runner has Git's `env.exe` on its PATH,
    // which a Windows machine as installed does not.
    const sys = process.env.SystemRoot ?? 'C:\\Windows'
    for (const k of Object.keys(env)) if (k.toUpperCase() === VAR || k.toUpperCase() === 'PATH') delete env[k]
    env.Path = [bin, `${sys}\\System32`, sys, `${sys}\\System32\\WindowsPowerShell\\v1.0`].join(';')
    if (paneDir !== null) env[VAR] = paneDir
    const [program, args] = shell === 'cmd' ? [process.env.COMSPEC ?? 'cmd.exe', ['/d', '/q']] : ['powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-']]
    const r = spawnSync(program, args, { input: `${line}\r\nclaude after\r\n`, env, encoding: 'utf8', timeout: 60_000, windowsHide: true })
    if (r.error) throw r.error
    // The job's log is the only place a failure here can be read.
    onTestFailed(() => console.log(`${shell} was typed: ${line}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`))
    return existsSync(out)
      ? readFileSync(out, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l))
      : []
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const DIRS = ['C:\\Users\\me\\.claude-work', 'C:\\Users\\Jo Doe\\.claude-work', 'C:\\a&b (1)\\c^d', "C:\\it's here"]

describe.runIf(windows).each(['cmd', 'powershell'])('%s runs what the app types', (shell) => {
  test('a command with no account in front of it runs, and the shell stays', () => {
    expect(run(shell, 'claude attach c2c2c2c2')).toEqual([
      { args: ['attach', 'c2c2c2c2'], dir: PANE_DIR },
      { args: ['after'], dir: PANE_DIR },
    ])
  })

  test.each(DIRS)("a session on another account gets that account's config dir, and the pane keeps its own: %s", (dir) => {
    expect(run(shell, withEnv('claude attach b0b0b0b0', VAR, dir, shell))).toEqual([
      { args: ['attach', 'b0b0b0b0'], dir },
      { args: ['after'], dir: PANE_DIR },
    ])
  })

  test("a session on the default account runs with the variable unset, and the pane keeps its own", () => {
    expect(run(shell, withEnv('claude stop a1a1a1a1', VAR, null, shell))).toEqual([
      { args: ['stop', 'a1a1a1a1'], dir: null },
      { args: ['after'], dir: PANE_DIR },
    ])
  })

  test('a pane on the default account is left with the variable unset', () => {
    expect(run(shell, withEnv('claude attach b0b0b0b0', VAR, DIRS[1], shell), null)).toEqual([
      { args: ['attach', 'b0b0b0b0'], dir: DIRS[1] },
      { args: ['after'], dir: null },
    ])
    expect(run(shell, withEnv('claude stop a1a1a1a1', VAR, null, shell), null)).toEqual([
      { args: ['stop', 'a1a1a1a1'], dir: null },
      { args: ['after'], dir: null },
    ])
  })

  test('the hidden attach leaves no shell behind it: nothing typed afterwards runs', () => {
    expect(run(shell, thenLeave('claude attach c2c2c2c2', shell))).toEqual([{ args: ['attach', 'c2c2c2c2'], dir: PANE_DIR }])
    expect(run(shell, thenLeave(withEnv('claude attach b0b0b0b0', VAR, DIRS[1], shell), shell))).toEqual([{ args: ['attach', 'b0b0b0b0'], dir: DIRS[1] }])
    expect(run(shell, thenLeave(withEnv('claude attach a1a1a1a1', VAR, null, shell), shell))).toEqual([{ args: ['attach', 'a1a1a1a1'], dir: null }])
  })

  test('the POSIX lines the app typed before never reach claude', () => {
    // What `as-me.ts` and `account.ts` wrote for every platform until #331.
    expect(run(shell, 'exec claude attach c2c2c2c2')).toEqual([{ args: ['after'], dir: PANE_DIR }])
    expect(run(shell, `env ${VAR}='C:\\Users\\Jo Doe\\.claude-work' claude attach b0b0b0b0`)).toEqual([{ args: ['after'], dir: PANE_DIR }])
    expect(run(shell, `env -u ${VAR} claude stop a1a1a1a1`)).toEqual([{ args: ['after'], dir: PANE_DIR }])
  })
})

test.skipIf(windows)('the Windows shells are only on CI', () => {
  // Says in every other log that the tests above did not run there.
  expect(process.platform).not.toBe('win32')
})
