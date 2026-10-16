import type { Account } from '../accounts/types'
import { withEnv } from '../pty/typed'
import { accountOf, attachCmd, envOfAccount, idOf, kindOfRow, onAccount, shellWord, stopCmd, withEnvs } from './account'

const work = { account: 'work', account_env: { config_dir: '/Users/me/.claude-work' } }
const home = { account: 'default', account_env: { config_dir: null } }

test('a command for a session on another account sets its config dir in front of it', () => {
  expect(onAccount('claude attach b0b0b0b0', work)).toBe('env CLAUDE_CONFIG_DIR=/Users/me/.claude-work claude attach b0b0b0b0')
})

test("a command for the default account's session unsets the variable, never sets it to ~/.claude", () => {
  expect(onAccount('claude attach a1a1a1a1', home)).toBe('env -u CLAUDE_CONFIG_DIR claude attach a1a1a1a1')
})

test('with one account, or a row from before accounts, the command is typed as it always was', () => {
  expect(onAccount('claude attach x', { account: 'default', account_env: null })).toBe('claude attach x')
  expect(onAccount('claude attach x', {})).toBe('claude attach x')
  expect(onAccount('claude attach x', null)).toBe('claude attach x')
  expect(onAccount('claude attach x', undefined)).toBe('claude attach x')
})

test('a config dir the shell would split or expand is quoted', () => {
  expect(shellWord('/Users/me/.claude-work')).toBe('/Users/me/.claude-work')
  expect(shellWord('/Users/Jo Doe/.claude-w')).toBe(`'/Users/Jo Doe/.claude-w'`)
  expect(shellWord("/x/it's $HOME")).toBe(`'/x/it'\\''s $HOME'`)
  expect(onAccount('claude stop x', { account_env: { config_dir: '/Users/Jo Doe/.claude-w' } })).toBe(`env CLAUDE_CONFIG_DIR='/Users/Jo Doe/.claude-w' claude stop x`)
})

test('attach and stop name the session and run on its account', () => {
  expect(attachCmd({ id: 'b0b0b0b0', ...work })).toBe('env CLAUDE_CONFIG_DIR=/Users/me/.claude-work claude attach b0b0b0b0')
  expect(stopCmd({ id: 'a1a1a1a1', ...home })).toBe('env -u CLAUDE_CONFIG_DIR claude stop a1a1a1a1')
  expect(stopCmd({ id: 'a1a1a1a1' })).toBe('claude stop a1a1a1a1')
})

test('a target is an id alone or a row that knows its account', () => {
  expect(idOf('x')).toBe('x')
  expect(accountOf('x')).toBeNull()
  const row = { id: 'y', ...work }
  expect(idOf(row)).toBe('y')
  expect(accountOf(row)).toBe(row)
})

/** Rows as the backend writes them since Grok accounts: every `account_env` carries its kind. */
const workK = { account: 'work', account_env: { config_dir: '/Users/me/.claude-work', kind: 'claude' as const } }
const homeK = { account: 'default', account_env: { config_dir: null, kind: 'claude' as const } }
const grokSide = { account: 'side', account_env: { config_dir: '/Users/me/.grok-side', kind: 'grok' as const } }
const grokHome = { account: 'grok', account_env: { config_dir: null, kind: 'grok' as const } }
const G = '019a2b3c-4d5e-7f00-8a9b-0c1d2e3f4a5b'

test("a command on a kinded account sets MNEMO_AGENT and the kind's own variable, set or unset", () => {
  expect(onAccount('claude --resume s1', workK, 'posix')).toBe('env MNEMO_AGENT=claude CLAUDE_CONFIG_DIR=/Users/me/.claude-work claude --resume s1')
  expect(onAccount('claude --resume s1', homeK, 'posix')).toBe('env -u CLAUDE_CONFIG_DIR MNEMO_AGENT=claude claude --resume s1')
  expect(onAccount('grok', grokSide, 'posix')).toBe('env MNEMO_AGENT=grok GROK_HOME=/Users/me/.grok-side grok')
  expect(onAccount('grok', grokHome, 'posix')).toBe('env -u GROK_HOME MNEMO_AGENT=grok grok')
})

test('a Grok command never names CLAUDE_CONFIG_DIR, and a Claude one never names GROK_HOME', () => {
  for (const shell of ['posix', 'cmd', 'powershell'] as const) {
    for (const s of [grokSide, grokHome]) expect(onAccount('grok', s, shell)).not.toContain('CLAUDE_CONFIG_DIR')
    for (const s of [workK, homeK]) expect(onAccount('claude', s, shell)).not.toContain('GROK_HOME')
  }
})

test('cmd and PowerShell set both variables and put both back', () => {
  expect(onAccount('grok', { account_env: { config_dir: 'C:\\Users\\Jo Doe\\.grok-w', kind: 'grok' } }, 'cmd')).toBe(
    'cmd /d /s /c "set "MNEMO_AGENT=grok"& set "GROK_HOME=C:\\Users\\Jo Doe\\.grok-w"& grok"',
  )
  expect(onAccount('grok', grokHome, 'cmd')).toBe('cmd /d /s /c "set "MNEMO_AGENT=grok"& set "GROK_HOME="& grok"')
  expect(onAccount('grok', { account_env: { config_dir: "C:\\it's", kind: 'grok' } }, 'powershell')).toBe(
    "$mnemoWas = $env:MNEMO_AGENT; $mnemoWas1 = $env:GROK_HOME; $env:MNEMO_AGENT = 'grok'; $env:GROK_HOME = 'C:\\it''s'; try { grok } finally { $env:MNEMO_AGENT = $mnemoWas; $env:GROK_HOME = $mnemoWas1 }",
  )
  expect(onAccount('grok', grokHome, 'powershell')).toContain('$env:GROK_HOME = $null;')
})

test('withEnvs with one variable is withEnv, in every shell', () => {
  for (const shell of ['posix', 'cmd', 'powershell'] as const) {
    for (const value of ['/Users/Jo Doe/.claude-w', 'C:\\a&b (1)\\c^d', "it's", null]) {
      expect(withEnvs('claude stop x', [['CLAUDE_CONFIG_DIR', value]], shell)).toBe(withEnv('claude stop x', 'CLAUDE_CONFIG_DIR', value, shell))
    }
  }
  expect(withEnvs('x', [], 'posix')).toBe('x')
})

test('a value cmd would act on gets its carets in every set', () => {
  expect(withEnvs('grok', [['A', 'C:\\a&b (1)\\c^d'], ['B', 'x|y']], 'cmd')).toBe('cmd /d /s /c "set "A=C:\\a^&b ^(1^)\\c^^d"& set "B=x^|y"& grok"')
})

test('attach and stop reach a Grok session on its own home: the TUI in leader mode, and mnemo grok close', () => {
  expect(attachCmd({ id: G, ...grokSide }, 'posix')).toBe(`env MNEMO_AGENT=grok GROK_HOME=/Users/me/.grok-side grok --leader -r ${G}`)
  expect(attachCmd({ id: G, ...grokHome }, 'posix')).toBe(`env -u GROK_HOME MNEMO_AGENT=grok grok --leader -r ${G}`)
  expect(stopCmd({ id: G, ...grokSide }, 'posix')).toBe(`env MNEMO_AGENT=grok GROK_HOME=/Users/me/.grok-side mnemo grok close ${G}`)
  expect(stopCmd({ id: G, ...grokHome }, 'posix')).toBe(`env -u GROK_HOME MNEMO_AGENT=grok mnemo grok close ${G}`)
  expect(attachCmd({ id: 'b0b0b0b0', ...workK }, 'posix')).toBe('env MNEMO_AGENT=claude CLAUDE_CONFIG_DIR=/Users/me/.claude-work claude attach b0b0b0b0')
  expect(stopCmd({ id: 'a1a1a1a1', ...homeK }, 'posix')).toBe('env -u CLAUDE_CONFIG_DIR MNEMO_AGENT=claude claude stop a1a1a1a1')
})

test('an account runs with its variable unset when it is the default or the Grok account at ~/.grok', () => {
  const a = (more: Partial<Account>): Account => ({ id: 'x', label: 'X', configDir: '/Users/me/.claude-x', isDefault: false, kind: 'claude', email: null, problem: null, unshared: [], ...more })
  expect(envOfAccount(a({ isDefault: true, configDir: '/Users/me/.claude' }))).toEqual({ config_dir: null, kind: 'claude' })
  expect(envOfAccount(a({}))).toEqual({ config_dir: '/Users/me/.claude-x', kind: 'claude' })
  expect(envOfAccount(a({ kind: 'grok', configDir: '/Users/me/.grok' }))).toEqual({ config_dir: null, kind: 'grok' })
  expect(envOfAccount(a({ kind: 'grok', configDir: 'C:\\Users\\me\\.grok' }))).toEqual({ config_dir: null, kind: 'grok' })
  expect(envOfAccount(a({ kind: 'grok', configDir: '/Users/me/.grok-side' }))).toEqual({ config_dir: '/Users/me/.grok-side', kind: 'grok' })
})

test('a row that does not say its kind is a Claude one', () => {
  expect(kindOfRow({})).toBe('claude')
  expect(kindOfRow(work)).toBe('claude')
  expect(kindOfRow(grokSide)).toBe('grok')
})
