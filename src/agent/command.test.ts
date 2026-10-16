import { sessionCommand } from './command'

test('Claude is typed byte for byte as before Grok: Launch agent, Home, the restore and a resume', () => {
  // Launch agent (`claudeCommand` before this): the permission setting, then the id or the resume.
  expect(sessionCommand('claude', { skipPermissions: true, sessionId: 'abc' })).toBe('claude --dangerously-skip-permissions --session-id abc')
  expect(sessionCommand('claude', { skipPermissions: false, sessionId: 'abc' })).toBe('claude --session-id abc')
  expect(sessionCommand('claude', { skipPermissions: true, resume: 'abc' })).toBe('claude --dangerously-skip-permissions --resume abc')
  expect(sessionCommand('claude', { skipPermissions: false, resume: 'abc' })).toBe('claude --resume abc')
  // Home's new session, and the resume Home and the restore type.
  expect(sessionCommand('claude', {})).toBe('claude')
  expect(sessionCommand('claude', { resume: 'abc' })).toBe('claude --resume abc')
})

test('Grok runs its TUI in leader mode, approving every tool when permissions are skipped', () => {
  expect(sessionCommand('grok', {})).toBe('grok --leader')
  expect(sessionCommand('grok', { skipPermissions: true, sessionId: 'abc' })).toBe('grok --leader --always-approve -s abc')
  expect(sessionCommand('grok', { skipPermissions: false, sessionId: 'abc' })).toBe('grok --leader -s abc')
  expect(sessionCommand('grok', { skipPermissions: true, resume: 'abc' })).toBe('grok --leader --always-approve -r abc')
  expect(sessionCommand('grok', { resume: 'abc' })).toBe('grok --leader -r abc')
})

test('a resume wins over a new id: neither CLI renames a resumed session without forking it', () => {
  expect(sessionCommand('claude', { resume: 'old', sessionId: 'new' })).toBe('claude --resume old')
  expect(sessionCommand('grok', { resume: 'old', sessionId: 'new' })).toBe('grok --leader -r old')
})
