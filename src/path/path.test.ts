import { expect, test } from 'vitest'
import { basename, dirname, isAbsolute, isWindowsPath, norm, relativeTo, samePath, within } from './path'

/** One folder as it reaches the front end on Windows: from git, from the OS, from `canonicalize`. */
const GIT = 'C:/Users/you/repo'
const OS = 'C:\\Users\\you\\repo'
const VERBATIM = '\\\\?\\C:\\Users\\you\\repo'
const SPELLINGS = [GIT, OS, VERBATIM, 'c:\\Users\\you\\repo\\', 'C:/Users/you/repo/']

test('all three Windows spellings of a folder are one path', () => {
  for (const s of SPELLINGS) {
    expect(norm(s), s).toBe(GIT)
    expect(isWindowsPath(s), s).toBe(true)
    expect(isAbsolute(s), s).toBe(true)
    for (const t of SPELLINGS) expect(samePath(s, t), `${s} ~ ${t}`).toBe(true)
  }
})

test('a drive root keeps its separator, whatever its spelling', () => {
  for (const s of ['C:\\', 'c:/', 'C:', '\\\\?\\C:\\', 'C:\\\\']) expect(norm(s), s).toBe('C:/')
  expect(within('C:\\Users', 'c:\\')).toBe(true)
  expect(basename('C:\\')).toBe('C:/')
  expect(dirname('C:\\Users')).toBe('C:/')
})

test('a share, plain or verbatim, is one path', () => {
  expect(norm('\\\\server\\share\\repo\\')).toBe('//server/share/repo')
  expect(norm('\\\\?\\UNC\\server\\share\\repo')).toBe('//server/share/repo')
  expect(samePath('\\\\server\\share\\repo', '//server/share/repo')).toBe(true)
})

test('within matches across spellings and not a sibling whose name starts the same', () => {
  for (const dir of SPELLINGS) {
    expect(within('C:\\Users\\you\\repo\\src', dir), dir).toBe(true)
    expect(within('C:/Users/you/repo/src', dir), dir).toBe(true)
    expect(within('\\\\?\\C:\\Users\\you\\repo', dir), dir).toBe(true)
    expect(within('C:\\Users\\you\\repo-wt-1', dir), dir).toBe(false)
  }
  expect(within('D:\\Users\\you\\repo', GIT)).toBe(false)
})

test('basename and dirname know both separators on a Windows path', () => {
  for (const s of SPELLINGS) {
    expect(basename(s), s).toBe('repo')
    expect(dirname(s), s).toBe('C:/Users/you')
  }
  expect(basename('C:\\Users\\you\\repo\\src\\main.rs')).toBe('main.rs')
})

test('relativeTo keeps the path in its own spelling', () => {
  expect(relativeTo('C:\\Users\\you\\repo\\src\\app.ts', GIT)).toBe('src\\app.ts')
  expect(relativeTo('C:/Users/you/repo/src/app.ts', OS)).toBe('src/app.ts')
  expect(relativeTo('\\\\?\\C:\\Users\\you\\repo\\src\\app.ts\\', OS)).toBe('src\\app.ts')
  expect(relativeTo(OS, VERBATIM)).toBe('')
  expect(relativeTo('C:\\Users\\you\\other\\a.ts', GIT)).toBe(null)
  expect(relativeTo('C:\\a.ts', 'C:\\')).toBe('a.ts')
})

test('POSIX paths are answered as before: only a trailing slash goes', () => {
  expect(norm('/Users/you/repo/')).toBe('/Users/you/repo')
  expect(norm('/Users/you/repo//')).toBe('/Users/you/repo')
  expect(norm('/')).toBe('/')
  expect(norm('')).toBe('')
  // `\` is a character a POSIX name may hold, not a separator.
  expect(norm('/Users/you/a\\b')).toBe('/Users/you/a\\b')
  expect(basename('/Users/you/a\\b')).toBe('a\\b')
  expect(isWindowsPath('/Users/you/repo')).toBe(false)
  expect(isAbsolute('/Users/you/repo')).toBe(true)
  expect(isAbsolute('src/app.ts')).toBe(false)
  expect(samePath('/a/b/', '/a/b')).toBe(true)
  expect(samePath('/a/B', '/a/b')).toBe(false)
  expect(within('/a/b/c', '/a/b/')).toBe(true)
  expect(within('/a/bc', '/a/b')).toBe(false)
  expect(within('/a', '/')).toBe(true)
  expect(basename('/a/b/')).toBe('b')
  expect(basename('/')).toBe('/')
  expect(dirname('/a/b/c.ts')).toBe('/a/b')
  expect(dirname('/a')).toBe('/')
  expect(relativeTo('/a/b/src/x.ts', '/a/b/')).toBe('src/x.ts')
  expect(relativeTo('/a/bc/x.ts', '/a/b')).toBe(null)
})
