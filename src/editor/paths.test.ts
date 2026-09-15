import { basename, dirname, join, normalize, resolvePath, languageFor, defaultRoot, visibleEntries } from './paths'
import type { State } from '../layout/store'

test('basename, dirname and join', () => {
  expect(basename('/a/b/c.ts')).toBe('c.ts')
  expect(basename('/a/b/')).toBe('b')
  expect(basename('/')).toBe('/')
  expect(dirname('/a/b/c.ts')).toBe('/a/b')
  expect(dirname('/a')).toBe('/')
  expect(join('/a', 'b')).toBe('/a/b')
  expect(join('/', 'b')).toBe('/b')
})

test('normalize collapses dots and slashes', () => {
  expect(normalize('/a//b/./c/../d')).toBe('/a/b/d')
  expect(normalize('/../..')).toBe('/')
})

test('resolvePath expands ~, keeps absolute, joins relative', () => {
  expect(resolvePath('~', '/w', '/Users/me')).toBe('/Users/me')
  expect(resolvePath('~/x.ts', '/w', '/Users/me')).toBe('/Users/me/x.ts')
  expect(resolvePath('  /etc/hosts ', '/w', '/Users/me')).toBe('/etc/hosts')
  expect(resolvePath('src/../README.md', '/w/proj', '/Users/me')).toBe('/w/proj/README.md')
  // `~name` is a relative path, not another user's home.
  expect(resolvePath('~x', '/w', '/Users/me')).toBe('/w/~x')
})

test('languageFor prefers filenames, then the longest extension', () => {
  const langs = [
    { id: 'typescript', extensions: ['.ts'] },
    { id: 'dts', extensions: ['.d.ts'] },
    { id: 'dockerfile', extensions: ['.dockerfile'], filenames: ['Dockerfile'] },
    { id: 'markdown', extensions: ['.md'] },
  ]
  expect(languageFor('/a/b.ts', langs)).toBe('typescript')
  expect(languageFor('/a/b.d.ts', langs)).toBe('dts')
  expect(languageFor('/a/Dockerfile', langs)).toBe('dockerfile')
  expect(languageFor('/a/README.MD', langs)).toBe('markdown')
  expect(languageFor('/a/LICENSE', langs)).toBe('plaintext')
})

test('defaultRoot: focused terminal cwd, then a terminal in the tab, then home', () => {
  const base: Pick<State, 'tabs' | 'activeTab' | 'panes'> = {
    activeTab: 't',
    tabs: [
      {
        id: 't',
        focused: 1,
        root: { kind: 'split', dir: 'row', ratio: 0.5, children: [{ kind: 'leaf', pane: 1 }, { kind: 'leaf', pane: -1 }] },
      },
      { id: 'other', focused: 2, root: { kind: 'leaf', pane: 2 } },
    ],
    panes: {
      1: { id: 1, view: 'terminal', cwd: '/work/a' },
      [-1]: { id: -1, view: 'editor' },
      2: { id: 2, view: 'terminal', cwd: '/elsewhere' },
    },
  }
  expect(defaultRoot(base, '/home')).toBe('/work/a')
  const editorFocused = { ...base, tabs: [{ ...base.tabs[0], focused: -1 }, base.tabs[1]] }
  expect(defaultRoot(editorFocused, '/home')).toBe('/work/a')
  const noCwd = { ...editorFocused, panes: { ...base.panes, 1: { id: 1, view: 'terminal' } } }
  // The terminal in another tab does not count.
  expect(defaultRoot(noCwd, '/home')).toBe('/home')
  expect(defaultRoot({ ...base, activeTab: 'gone' }, '/home')).toBe('/home')
})

test('visibleEntries hides .git and .DS_Store', () => {
  const e = (name: string, is_dir = false) => ({ name, is_dir })
  expect(visibleEntries([e('.git', true), e('.github', true), e('.DS_Store'), e('a.ts')]).map((x) => x.name)).toEqual([
    '.github',
    'a.ts',
  ])
})
