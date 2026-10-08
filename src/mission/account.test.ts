import { accountOf, attachCmd, idOf, onAccount, shellWord, stopCmd } from './account'

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
