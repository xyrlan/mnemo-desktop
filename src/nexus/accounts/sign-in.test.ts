import { account } from '../../accounts/testing'
import { signInCommand } from './sign-in'

test('another account signs in on its own folder, whichever account the terminal spawned on', () => {
  expect(signInCommand(account('work'), 'posix')).toBe('env CLAUDE_CONFIG_DIR=/Users/me/.claude-work claude')
  expect(signInCommand(account('work', { configDir: "/Users/me/my 'work'" }), 'posix')).toBe(`env CLAUDE_CONFIG_DIR='/Users/me/my '\\''work'\\''' claude`)
  expect(signInCommand(account('work', { configDir: 'C:\\Users\\me\\.claude-work' }), 'cmd')).toBe('cmd /d /s /c "set "CLAUDE_CONFIG_DIR=C:\\Users\\me\\.claude-work"& claude"')
  expect(signInCommand(account('work'), 'powershell')).toContain("$env:CLAUDE_CONFIG_DIR = '/Users/me/.claude-work'; try { claude }")
})

test('the default account signs in with the variable unset, never set to ~/.claude', () => {
  expect(signInCommand(account('default'), 'posix')).toBe('env -u CLAUDE_CONFIG_DIR claude')
  expect(signInCommand(account('default'), 'powershell')).toContain('$env:CLAUDE_CONFIG_DIR = $null')
})
