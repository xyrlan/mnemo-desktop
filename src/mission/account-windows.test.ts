// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onTestFailed, vi } from 'vitest'
import { onAccount } from './account'

/** The lines `onAccount` writes for cmd and PowerShell on a kinded account, run by the real
 *  shells, as `scripts/typed-windows.test.mjs` runs `withEnv`'s one-variable lines. CI's
 *  `windows-latest` job is where these run, and everywhere else they are skipped. Each shell reads
 *  the line from its standard input with a stand-in `grok` first on `PATH` that records its
 *  arguments and the three variables it was started with; a second line, `grok after`, says what
 *  the shell was left like. */

const windows = process.platform === 'win32'
vi.setConfig({ testTimeout: 180_000 })
const VARS = ['MNEMO_AGENT', 'GROK_HOME', 'CLAUDE_CONFIG_DIR'] as const
/** What the shell itself starts with: a pane spawned on a Claude account. */
const PANE = { MNEMO_AGENT: 'claude', CLAUDE_CONFIG_DIR: 'C:\\pane-account' }

type Call = { args: string[]; MNEMO_AGENT: string | null; GROK_HOME: string | null; CLAUDE_CONFIG_DIR: string | null }

function run(shell: 'cmd' | 'powershell', line: string): Call[] {
  const root = mkdtempSync(join(tmpdir(), 'mnemo typed '))
  try {
    const bin = join(root, 'bin')
    mkdirSync(bin)
    const out = join(root, 'calls.jsonl')
    const record = VARS.map((v) => `${v}: process.env.${v} ?? null`).join(', ')
    writeFileSync(join(bin, 'grok.js'), `require('node:fs').appendFileSync(process.env.MNEMO_TYPED_OUT, JSON.stringify({ args: process.argv.slice(2), ${record} }) + '\\n')\n`)
    writeFileSync(join(bin, 'grok.cmd'), `@"${process.execPath}" "%~dp0grok.js" %*\r\n`)
    const env: Record<string, string> = { ...(process.env as Record<string, string>), MNEMO_TYPED_OUT: out }
    const sys = process.env.SystemRoot ?? 'C:\\Windows'
    for (const k of Object.keys(env)) if ((VARS as readonly string[]).includes(k.toUpperCase()) || k.toUpperCase() === 'PATH') delete env[k]
    env.Path = [bin, `${sys}\\System32`, sys, `${sys}\\System32\\WindowsPowerShell\\v1.0`].join(';')
    Object.assign(env, PANE)
    const [program, args] = shell === 'cmd' ? [process.env.COMSPEC ?? 'cmd.exe', ['/d', '/q']] : ['powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-']]
    const r = spawnSync(program, args, { input: `${line}\r\ngrok after\r\n`, env, encoding: 'utf8', timeout: 60_000, windowsHide: true })
    if (r.error) throw r.error
    onTestFailed(() => console.log(`${shell} was typed: ${line}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`))
    return existsSync(out)
      ? readFileSync(out, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l) as Call)
      : []
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const after: Call = { args: ['after'], MNEMO_AGENT: 'claude', GROK_HOME: null, CLAUDE_CONFIG_DIR: PANE.CLAUDE_CONFIG_DIR }
const HOMES = ['C:\\Users\\me\\.grok-work', 'C:\\Users\\Jo Doe\\.grok-work', 'C:\\a&b (1)\\c^d', "C:\\it's here"]

describe.runIf(windows).each(['cmd', 'powershell'] as const)('%s runs a Grok command on its own account', (shell) => {
  test.each(HOMES)('a Grok home in GROK_HOME and MNEMO_AGENT=grok, and the pane keeps its own: %s', (home) => {
    expect(run(shell, onAccount('grok --leader -r abc', { account_env: { config_dir: home, kind: 'grok' } }, shell))).toEqual([
      { args: ['--leader', '-r', 'abc'], MNEMO_AGENT: 'grok', GROK_HOME: home, CLAUDE_CONFIG_DIR: PANE.CLAUDE_CONFIG_DIR },
      after,
    ])
  })

  test('the Grok account at ~/.grok runs with GROK_HOME unset', () => {
    expect(run(shell, onAccount('grok login', { account_env: { config_dir: null, kind: 'grok' } }, shell))).toEqual([
      { args: ['login'], MNEMO_AGENT: 'grok', GROK_HOME: null, CLAUDE_CONFIG_DIR: PANE.CLAUDE_CONFIG_DIR },
      after,
    ])
  })
})
