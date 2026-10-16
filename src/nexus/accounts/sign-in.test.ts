import { account } from '../../accounts/testing'
import { signInCommand } from './sign-in'

const work = account('work', { kind: 'claude' })
const def = account('default', { kind: 'claude' })

test('another account signs in on its own folder, whichever account the terminal spawned on', () => {
  expect(signInCommand(work, 'posix')).toBe('env MNEMO_AGENT=claude CLAUDE_CONFIG_DIR=/Users/me/.claude-work claude')
  expect(signInCommand({ ...work, configDir: "/Users/me/my 'work'" }, 'posix')).toBe(`env MNEMO_AGENT=claude CLAUDE_CONFIG_DIR='/Users/me/my '\\''work'\\''' claude`)
  expect(signInCommand({ ...work, configDir: 'C:\\Users\\me\\.claude-work' }, 'cmd')).toBe('cmd /d /s /c "set "MNEMO_AGENT=claude"& set "CLAUDE_CONFIG_DIR=C:\\Users\\me\\.claude-work"& claude"')
  expect(signInCommand(work, 'powershell')).toContain("$env:CLAUDE_CONFIG_DIR = '/Users/me/.claude-work'; try { claude }")
})

test('the default account signs in with the variable unset, never set to ~/.claude', () => {
  expect(signInCommand(def, 'posix')).toBe('env -u CLAUDE_CONFIG_DIR MNEMO_AGENT=claude claude')
  expect(signInCommand(def, 'powershell')).toContain('$env:CLAUDE_CONFIG_DIR = $null')
})

test('a Grok account signs in with grok login on its own home: ~/.grok with GROK_HOME unset', () => {
  expect(signInCommand(account('side', { kind: 'grok', configDir: '/Users/me/.grok-side' }), 'posix')).toBe('env MNEMO_AGENT=grok GROK_HOME=/Users/me/.grok-side grok login')
  expect(signInCommand(account('grok', { kind: 'grok', configDir: '/Users/me/.grok' }), 'posix')).toBe('env -u GROK_HOME MNEMO_AGENT=grok grok login')
})
