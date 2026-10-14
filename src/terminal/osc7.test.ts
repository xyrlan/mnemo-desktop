import { parseOsc7, parseOsc9 } from './osc7'

test('parses file URL with host', () => {
  expect(parseOsc7('file://mac.local/Users/x/github')).toBe('/Users/x/github')
})
test('parses without host and decodes', () => {
  expect(parseOsc7('file:///tmp/a%20b')).toBe('/tmp/a b')
})
test('rejects other payloads', () => {
  expect(parseOsc7('nonsense')).toBeNull()
  expect(parseOsc7('file://h/%zz')).toBeNull()
})

test('on Windows a drive reads as C:/ in every spelling, and as it came elsewhere', () => {
  expect(parseOsc7('file://pc/C:/Users/me/a%20b', true)).toBe('C:/Users/me/a b')
  expect(parseOsc7('file:///c:/x', true)).toBe('C:/x')
  // Git Bash, as the bash integration sends `$PWD` there.
  expect(parseOsc7('file://pc/c/Users/me/repo', true)).toBe('C:/Users/me/repo')
  expect(parseOsc7('file://pc/d', true)).toBe('D:/')
  expect(parseOsc7('file://pc/cygdrive/e/w', true)).toBe('E:/w')
  expect(parseOsc7('file://pc/home/me', true)).toBe('/home/me')
  // macOS and Linux: `/c/x` is a folder like any other.
  expect(parseOsc7('file://pc/c/Users', false)).toBe('/c/Users')
  expect(parseOsc7('file://pc/C:/x', false)).toBe('/C:/x')
})

test('OSC 9;9 is the folder as the shell spells it, quoted or not; another OSC 9 is none', () => {
  expect(parseOsc9('9;C:\\Users\\me')).toBe('C:\\Users\\me')
  expect(parseOsc9('9;"C:\\Program Files"')).toBe('C:\\Program Files')
  expect(parseOsc9('9;C:\\a;b')).toBe('C:\\a;b')
  expect(parseOsc9('9;\\\\wsl.localhost\\Ubuntu\\home\\me')).toBe('\\\\wsl.localhost\\Ubuntu\\home\\me')
  expect(parseOsc9('9;')).toBeNull()
  expect(parseOsc9('build finished')).toBeNull()
  expect(parseOsc9('4;1;50')).toBeNull()
})
