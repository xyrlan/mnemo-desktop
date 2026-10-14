import { attachCmd, onAccount, stopCmd } from '../mission/account'
import { enter, notTyped, paneShell, shellOf, thenLeave, typed, withEnv, type Shell } from './typed'

/** A child on a second account, and one on the default account while a second exists. */
const posixWork = { id: 'b0b0b0b0', account: 'work', account_env: { config_dir: '/Users/me/.claude-work' } }
const winWork = { id: 'b0b0b0b0', account: 'work', account_env: { config_dir: 'C:\\Users\\Jo Doe\\.claude-work' } }
const onDefault = { id: 'a1a1a1a1', account: 'default', account_env: { config_dir: null } }
const alone = { id: 'c2c2c2c2' }

/** Every command the app types into a pane, as it is typed there: Enter included. */
function lines(shell: Shell, work: typeof posixWork) {
  /** Approve, Deny, a question's answer and "As me": the hidden attach (`as-me.ts`, `attached`). */
  const hidden = (s: { id: string }) => typed(thenLeave(attachCmd(s, shell), shell), shell, '\r')
  return {
    'hidden attach, one account': hidden(alone),
    'hidden attach, second account': hidden(work),
    'hidden attach, default account': hidden(onDefault),
    'take over, one account': typed(attachCmd(alone, shell), shell),
    'take over, second account': typed(attachCmd(work, shell), shell),
    'take over, default account': typed(attachCmd(onDefault, shell), shell),
    'stop, one account': typed(stopCmd(alone, shell), shell),
    'stop, second account': typed(stopCmd(work, shell), shell),
    'stop, default account': typed(stopCmd(onDefault, shell), shell),
    'resume at launch': typed('claude --resume sess-1', shell),
    'resume from Home, second account': typed(onAccount('claude --resume sess-1', work, shell), shell),
    'resume from Home, default account': typed(onAccount('claude --resume sess-1', onDefault, shell), shell),
  }
}

test('a POSIX shell is typed what it always was', () => {
  expect(lines('posix', posixWork)).toEqual({
    'hidden attach, one account': 'exec claude attach c2c2c2c2\r',
    'hidden attach, second account': 'exec env CLAUDE_CONFIG_DIR=/Users/me/.claude-work claude attach b0b0b0b0\r',
    'hidden attach, default account': 'exec env -u CLAUDE_CONFIG_DIR claude attach a1a1a1a1\r',
    'take over, one account': 'claude attach c2c2c2c2\n',
    'take over, second account': 'env CLAUDE_CONFIG_DIR=/Users/me/.claude-work claude attach b0b0b0b0\n',
    'take over, default account': 'env -u CLAUDE_CONFIG_DIR claude attach a1a1a1a1\n',
    'stop, one account': 'claude stop c2c2c2c2\n',
    'stop, second account': 'env CLAUDE_CONFIG_DIR=/Users/me/.claude-work claude stop b0b0b0b0\n',
    'stop, default account': 'env -u CLAUDE_CONFIG_DIR claude stop a1a1a1a1\n',
    'resume at launch': 'claude --resume sess-1\n',
    'resume from Home, second account': 'env CLAUDE_CONFIG_DIR=/Users/me/.claude-work claude --resume sess-1\n',
    'resume from Home, default account': 'env -u CLAUDE_CONFIG_DIR claude --resume sess-1\n',
  })
})

test('cmd is typed no exec, no env and no single quotes, and Enter is a carriage return', () => {
  expect(lines('cmd', winWork)).toEqual({
    'hidden attach, one account': 'claude attach c2c2c2c2 & exit\r',
    'hidden attach, second account': 'cmd /d /s /c "set "CLAUDE_CONFIG_DIR=C:\\Users\\Jo Doe\\.claude-work"& claude attach b0b0b0b0" & exit\r',
    'hidden attach, default account': 'cmd /d /s /c "set "CLAUDE_CONFIG_DIR="& claude attach a1a1a1a1" & exit\r',
    'take over, one account': 'claude attach c2c2c2c2\r',
    'take over, second account': 'cmd /d /s /c "set "CLAUDE_CONFIG_DIR=C:\\Users\\Jo Doe\\.claude-work"& claude attach b0b0b0b0"\r',
    'take over, default account': 'cmd /d /s /c "set "CLAUDE_CONFIG_DIR="& claude attach a1a1a1a1"\r',
    'stop, one account': 'claude stop c2c2c2c2\r',
    'stop, second account': 'cmd /d /s /c "set "CLAUDE_CONFIG_DIR=C:\\Users\\Jo Doe\\.claude-work"& claude stop b0b0b0b0"\r',
    'stop, default account': 'cmd /d /s /c "set "CLAUDE_CONFIG_DIR="& claude stop a1a1a1a1"\r',
    'resume at launch': 'claude --resume sess-1\r',
    'resume from Home, second account': 'cmd /d /s /c "set "CLAUDE_CONFIG_DIR=C:\\Users\\Jo Doe\\.claude-work"& claude --resume sess-1"\r',
    'resume from Home, default account': 'cmd /d /s /c "set "CLAUDE_CONFIG_DIR="& claude --resume sess-1"\r',
  })
})

test('PowerShell is typed its own variable syntax, and puts the variable back', () => {
  const set = "$mnemoWas = $env:CLAUDE_CONFIG_DIR; $env:CLAUDE_CONFIG_DIR = 'C:\\Users\\Jo Doe\\.claude-work'; try { "
  const unset = '$mnemoWas = $env:CLAUDE_CONFIG_DIR; $env:CLAUDE_CONFIG_DIR = $null; try { '
  const back = ' } finally { $env:CLAUDE_CONFIG_DIR = $mnemoWas }'
  expect(lines('powershell', winWork)).toEqual({
    'hidden attach, one account': 'claude attach c2c2c2c2; exit\r',
    'hidden attach, second account': `${set}claude attach b0b0b0b0${back}; exit\r`,
    'hidden attach, default account': `${unset}claude attach a1a1a1a1${back}; exit\r`,
    'take over, one account': 'claude attach c2c2c2c2\r',
    'take over, second account': `${set}claude attach b0b0b0b0${back}\r`,
    'take over, default account': `${unset}claude attach a1a1a1a1${back}\r`,
    'stop, one account': 'claude stop c2c2c2c2\r',
    'stop, second account': `${set}claude stop b0b0b0b0${back}\r`,
    'stop, default account': `${unset}claude stop a1a1a1a1${back}\r`,
    'resume at launch': 'claude --resume sess-1\r',
    'resume from Home, second account': `${set}claude --resume sess-1${back}\r`,
    'resume from Home, default account': `${unset}claude --resume sess-1${back}\r`,
  })
})

test("a config dir with characters the shell acts on reaches it whole", () => {
  expect(withEnv('claude stop x', 'CLAUDE_CONFIG_DIR', 'C:\\a&b (1)\\c^d', 'cmd')).toBe('cmd /d /s /c "set "CLAUDE_CONFIG_DIR=C:\\a^&b ^(1^)\\c^^d"& claude stop x"')
  expect(withEnv('claude stop x', 'CLAUDE_CONFIG_DIR', "C:\\it's", 'powershell')).toContain("$env:CLAUDE_CONFIG_DIR = 'C:\\it''s';")
  expect(withEnv('claude stop x', 'CLAUDE_CONFIG_DIR', "/x/it's $HOME", 'posix')).toBe(`env CLAUDE_CONFIG_DIR='/x/it'\\''s $HOME' claude stop x`)
})

test('Enter is a carriage return on Windows; a POSIX shell keeps the one each place typed', () => {
  expect(enter('cmd')).toBe('\r')
  expect(enter('powershell')).toBe('\r')
  expect(enter('cmd', '\n')).toBe('\r')
  expect(enter('posix')).toBe('\n')
  expect(enter('posix', '\r')).toBe('\r')
})

test('a pane just spawned runs cmd on Windows and a POSIX shell elsewhere; a prompt read later tells PowerShell', () => {
  expect(paneShell(true)).toBe('cmd')
  expect(paneShell(false)).toBe('posix')
  expect(paneShell()).toBe('posix')
  expect(shellOf(['PS C:\\Users\\me> ', '', ''], true)).toBe('powershell')
  expect(shellOf(['C:\\Users\\me>'], true)).toBe('cmd')
  expect(shellOf([], true)).toBe('cmd')
  expect(shellOf(['PS1 % '], false)).toBe('posix')
})

test('on Windows a pane just spawned is the kind of shell chosen for new panes (#360)', () => {
  expect(paneShell(true, 'powershell')).toBe('powershell')
  expect(paneShell(true, 'posix')).toBe('posix')
  expect(paneShell(true, null)).toBe('cmd')
  // macOS and Linux: whatever was chosen on Windows, a POSIX shell.
  expect(paneShell(false, 'powershell')).toBe('posix')
  // A prompt that is neither PowerShell's nor cmd's is the kind new panes start: Git Bash's.
  expect(shellOf(['me@pc MINGW64 ~/repo', '$ '], true, 'posix')).toBe('posix')
  expect(shellOf(['me@pc MINGW64 ~/repo', '$ '], true, null)).toBe('cmd')
  expect(shellOf(['C:\\Users\\me>'], true, 'posix')).toBe('cmd')
  expect(shellOf(['\\\\server\\share\\x> '], true, 'powershell')).toBe('cmd')
  expect(shellOf(['PS C:\\Users\\me> '], true, 'posix')).toBe('powershell')
  // Git Bash reads its Enter from a Windows console: `\r`, as cmd's.
  expect(enter('posix', '\n', true)).toBe('\r')
  expect(typed('ls', 'posix')).toBe('ls\n')
})

test('a command that could not be typed is a line for the terminal, naming the command and the reason', () => {
  const text = new TextDecoder().decode(notTyped('claude --resume abc', new Error('pane 4 has exited')))
  expect(text).toContain('mnemo: could not type `claude --resume abc` here: pane 4 has exited')
  expect(text.startsWith('\r\n')).toBe(true)
  expect(text.endsWith('\r\n')).toBe(true)
  expect(new TextDecoder().decode(notTyped('x', 'no pane'))).toContain('here: no pane')
})
