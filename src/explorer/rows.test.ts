import { createRowProjection, filteredRows, flattenTree, nameFilterTokens, openFolders, NAME_FILTER_QUERY_MAX_BYTES, type Visibility } from './rows'
import { ancestorsOf, isDotfileRelativePath, isPathIgnored, relativeTo } from './paths'
import { resolveNavigationTarget } from './keyboard'
import { fileStatuses, folderStatuses, parseIgnored, statusOf } from './git'
import type { Change } from '../commit/client'
import type { DirEntry } from './types'

const R = '/code/app'
const d = (name: string): DirEntry => ({ name, isDirectory: true })
const f = (name: string): DirEntry => ({ name, isDirectory: false })
const ALL: Visibility = { showDotfiles: true, showIgnored: true, ignored: new Set() }

const dirs: Record<string, DirEntry[]> = {
  [R]: [d('.github'), d('node_modules'), d('.git'), d('src'), d('dist'), f('.env'), f('README.md')],
  [`${R}/src`]: [d('ui'), f('main.ts')],
  [`${R}/src/ui`]: [f('button.tsx')],
  [`${R}/.github`]: [f('ci.yml')],
}

const names = (rows: { relativePath: string; depth: number }[]) => rows.map((r) => `${'  '.repeat(r.depth)}${r.relativePath}`)

describe('the flat tree', () => {
  it("draws the root's listing and each open folder's inside it, never .git or node_modules", () => {
    const rows = flattenTree(R, dirs, new Set([`${R}/src`, `${R}/src/ui`]), ALL)
    expect(names(rows)).toEqual(['.github', 'src', '  src/ui', '    src/ui/button.tsx', '  src/main.ts', 'dist', '.env', 'README.md'])
    expect(rows[2]).toEqual({ name: 'ui', path: `${R}/src/ui`, relativePath: 'src/ui', isDirectory: true, depth: 1 })
  })

  it('shows an open folder not read yet as closed, and a closed one without its listing', () => {
    expect(names(flattenTree(R, dirs, new Set([`${R}/dist`]), ALL))).toEqual(['.github', 'src', 'dist', '.env', 'README.md'])
    expect(names(flattenTree(R, dirs, new Set([`${R}/src/ui`]), ALL))).toEqual(['.github', 'src', 'dist', '.env', 'README.md'])
  })

  it('hides dotfiles and what git ignores when asked to', () => {
    const v = { showDotfiles: false, showIgnored: false, ignored: new Set(['dist']) }
    expect(names(flattenTree(R, dirs, new Set([`${R}/.github`]), v))).toEqual(['src', 'README.md'])
    expect(names(flattenTree(R, dirs, new Set(), { ...v, showIgnored: true }))).toEqual(['src', 'dist', 'README.md'])
  })
})

describe('the name filter', () => {
  const files = ['src/ui/button.tsx', 'src/ui/Button.test.tsx', 'src/main.ts', 'docs/buttons.md', '.github/button.yml', 'node_modules/x/button.js', 'dist/button.js']

  it('draws the matching files under their folders, folders first, every folder open', () => {
    expect(names(filteredRows(R, files, 'button', ALL, new Set()))).toEqual([
      '.github',
      '  .github/button.yml',
      'dist',
      '  dist/button.js',
      'docs',
      '  docs/buttons.md',
      'src',
      '  src/ui',
      '    src/ui/Button.test.tsx',
      '    src/ui/button.tsx',
    ])
  })

  it('matches every word anywhere in the path, ignoring case', () => {
    expect(names(filteredRows(R, files, 'UI  test', ALL, new Set()))).toEqual(['src', '  src/ui', '    src/ui/Button.test.tsx'])
    expect(filteredRows(R, files, 'nothing', ALL, new Set())).toEqual([])
  })

  it('keeps a folder the user closed closed, and respects the toggles', () => {
    const v = { showDotfiles: false, showIgnored: false, ignored: new Set(['dist']) }
    const rows = filteredRows(R, files, 'button', v, new Set([`${R}/src/ui`]))
    expect(names(rows)).toEqual(['docs', '  docs/buttons.md', 'src', '  src/ui'])
    expect([...openFolders(rows)]).toEqual([`${R}/docs`, `${R}/src`])
  })

  it('treats a blank or oversized query as no filter', () => {
    expect(nameFilterTokens('   ')).toEqual([])
    expect(nameFilterTokens('a'.repeat(NAME_FILTER_QUERY_MAX_BYTES + 1))).toEqual([])
    expect(filteredRows(R, files, '  ', ALL, new Set())).toEqual([])
  })
})

describe('paths', () => {
  it('knows what is inside the worktree and the folders on the way', () => {
    expect(relativeTo(R, `${R}/src/a.ts`)).toBe('src/a.ts')
    expect(relativeTo(R, '/code/app-other/a.ts')).toBeNull()
    expect(ancestorsOf(R, `${R}/src/ui/b.tsx`)).toEqual([`${R}/src`, `${R}/src/ui`])
    expect(ancestorsOf(R, `${R}/top.ts`)).toEqual([])
  })

  it('reads a path as ignored when a folder above it is', () => {
    const ignored = new Set(['dist', 'a/b.log'])
    expect(isPathIgnored(ignored, 'dist/x/y.js')).toBe(true)
    expect(isPathIgnored(ignored, 'a/b.log')).toBe(true)
    expect(isPathIgnored(ignored, 'a/c.log')).toBe(false)
    expect(isPathIgnored(ignored, 'distant')).toBe(false)
  })

  it('reads a dot segment anywhere as a dotfile, but not . or ..', () => {
    expect(isDotfileRelativePath('.github/ci.yml')).toBe(true)
    expect(isDotfileRelativePath('src/.env')).toBe(true)
    expect(isDotfileRelativePath('src/a.ts')).toBe(false)
  })
})

describe('keyboard navigation', () => {
  const rows = flattenTree(R, dirs, new Set([`${R}/src`]), ALL)
  // .github, src, src/ui, src/main.ts, dist, .env, README.md
  const projection = createRowProjection(rows)
  const at = (key: Parameters<typeof resolveNavigationTarget>[0]['key'], currentIndex: number | null) =>
    resolveNavigationTarget({ key, currentIndex, rowProjection: projection, total: rows.length, isExpanded: (p) => p === `${R}/src` })

  it('moves along the visible rows and stops at the ends', () => {
    expect(at('ArrowDown', null)).toEqual({ type: 'move', targetIndex: 0 })
    expect(at('ArrowUp', null)).toEqual({ type: 'move', targetIndex: 6 })
    expect(at('ArrowDown', 6)).toEqual({ type: 'move', targetIndex: 6 })
    expect(at('ArrowUp', 0)).toEqual({ type: 'move', targetIndex: 0 })
    expect(at('End', 2)).toEqual({ type: 'move', targetIndex: 6 })
    expect(at('Home', 2)).toEqual({ type: 'move', targetIndex: 0 })
  })

  it('opens a closed folder with Right, then steps into it', () => {
    expect(at('ArrowRight', 2)).toEqual({ type: 'toggle-expand', currentIndex: 2, dirPath: `${R}/src/ui` })
    expect(at('ArrowRight', 1)).toEqual({ type: 'move', targetIndex: 2 })
    expect(at('ArrowRight', 3)).toEqual({ type: 'move', targetIndex: 3 })
  })

  it('closes an open folder with Left, else steps to the parent', () => {
    expect(at('ArrowLeft', 1)).toEqual({ type: 'toggle-collapse', currentIndex: 1, dirPath: `${R}/src` })
    expect(at('ArrowLeft', 3)).toEqual({ type: 'move', targetIndex: 1 })
    expect(at('ArrowLeft', 0)).toEqual({ type: 'no-op' })
  })
})

describe('git decorations', () => {
  const c = (path: string, index: string, worktree: string, conflicted = false): Change => ({ path, origPath: null, index, worktree, conflicted })

  it("reads the worktree's letter over the index's", () => {
    expect(statusOf(c('a', 'A', '.'))).toBe('added')
    expect(statusOf(c('a', 'A', 'M'))).toBe('modified')
    expect(statusOf(c('a', '?', '?'))).toBe('untracked')
    expect(statusOf(c('a', 'R', '.'))).toBe('renamed')
    expect(statusOf(c('a', 'U', 'U', true))).toBe('conflicted')
    expect(statusOf(c('a', '.', 'X'))).toBeNull()
  })

  it('gives each folder above a change the status most worth a look', () => {
    const folders = folderStatuses(fileStatuses([c('src/ui/new.ts', '?', '?'), c('src/ui/b.ts', '.', 'M'), c('src/x.ts', 'A', '.'), c('top.ts', '.', 'M')]))
    expect(Object.fromEntries(folders)).toEqual({ 'src/ui': 'modified', src: 'modified' })
  })

  it("reads git's ignored list, folders named once", () => {
    expect([...parseIgnored(['dist/', 'a/b.log', '', 'node_modules/'])]).toEqual(['dist', 'a/b.log', 'node_modules'])
  })
})
