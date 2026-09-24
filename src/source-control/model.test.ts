import type { ScmEntry } from './client'
import { baseName, canDiscard, canStage, canUnstage, dirName, discardCopy, discardPaths, sectionsOf, unstagePaths } from './model'

const e = (path: string, area: ScmEntry['area'], status: ScmEntry['status'] = 'modified', oldPath: string | null = null): ScmEntry => ({
  path,
  oldPath,
  area,
  status,
  added: null,
  removed: null,
})

it('lists conflicts, staged, unstaged and untracked in that order, leaving out empty sections', () => {
  const entries = [e('n.txt', 'untracked', 'untracked'), e('b.ts', 'unstaged'), e('a.ts', 'staged'), e('c.ts', 'unstaged'), e('x.ts', 'conflicted', 'conflicted')]
  const got = sectionsOf(entries).map((s) => [s.area, s.title, s.entries.map((x) => x.path)])
  expect(got).toEqual([
    ['conflicted', 'Conflicts', ['x.ts']],
    ['staged', 'Staged Changes', ['a.ts']],
    ['unstaged', 'Changes', ['b.ts', 'c.ts']],
    ['untracked', 'Untracked Files', ['n.txt']],
  ])
  expect(sectionsOf([e('a.ts', 'staged')]).map((s) => s.area)).toEqual(['staged'])
  expect(sectionsOf([])).toEqual([])
})

it('offers each action only where git can take it', () => {
  const table = (['staged', 'unstaged', 'untracked', 'conflicted'] as const).map((a) => [a, canStage(e('f', a)), canUnstage(e('f', a)), canDiscard(e('f', a))])
  expect(table).toEqual([
    ['staged', false, true, false],
    ['unstaged', true, false, true],
    ['untracked', true, false, true],
    ['conflicted', true, false, false],
  ])
})

it('unstages a rename by both of its paths, each once', () => {
  expect(unstagePaths([e('new.ts', 'staged', 'renamed', 'old.ts'), e('a.ts', 'staged'), e('a.ts', 'staged')])).toEqual(['new.ts', 'old.ts', 'a.ts'])
})

it('discards tracked changes and untracked files apart, and never a staged or conflicted one', () => {
  const got = discardPaths([e('a.ts', 'unstaged'), e('n.txt', 'untracked', 'untracked'), e('s.ts', 'staged'), e('x.ts', 'conflicted', 'conflicted'), e('gone.ts', 'unstaged', 'deleted')])
  expect(got).toEqual({ tracked: ['a.ts', 'gone.ts'], untracked: ['n.txt'] })
})

it('says delete when the file goes, restore for a deletion, discard otherwise', () => {
  expect(discardCopy({ kind: 'entry', entry: e('src/n.txt', 'untracked', 'untracked') })).toMatchObject({ title: 'Delete "n.txt"?', confirm: 'Delete', deletes: true })
  expect(discardCopy({ kind: 'entry', entry: e('src/gone.ts', 'unstaged', 'deleted') })).toMatchObject({ title: 'Restore "gone.ts"?', confirm: 'Restore', deletes: false })
  expect(discardCopy({ kind: 'entry', entry: e('src/a.ts', 'unstaged') })).toMatchObject({ title: 'Discard changes to "a.ts"?', confirm: 'Discard', deletes: false })
  const two = [e('a', 'untracked', 'untracked'), e('b', 'untracked', 'untracked')]
  expect(discardCopy({ kind: 'area', area: 'untracked', entries: two })).toMatchObject({ title: 'Delete 2 untracked files?', confirm: 'Delete 2', deletes: true })
  expect(discardCopy({ kind: 'area', area: 'untracked', entries: two.slice(1) })).toMatchObject({ title: 'Delete 1 untracked file?', confirm: 'Delete' })
  expect(discardCopy({ kind: 'area', area: 'unstaged', entries: [e('a', 'unstaged')] }).description).toContain('in 1 file.')
  for (const p of [{ kind: 'entry', entry: e('a', 'unstaged') }, { kind: 'area', area: 'unstaged', entries: two }] as const) expect(discardCopy(p).description).toContain('cannot be undone')
})

it('a nested repository, listed as one untracked folder, is named by its folder and never discarded', () => {
  const inner = e('vendor/inner/', 'untracked', 'untracked')
  expect([baseName(inner.path), dirName(inner.path)]).toEqual(['inner', 'vendor'])
  expect([baseName('a.ts'), dirName('a.ts'), baseName('src/a.ts'), dirName('src/a.ts')]).toEqual(['a.ts', '', 'a.ts', 'src'])
  expect(canDiscard(inner)).toBe(false)
  expect(canStage(inner)).toBe(true)
  expect(discardPaths([inner, e('n.txt', 'untracked', 'untracked')])).toEqual({ tracked: [], untracked: ['n.txt'] })
})
