import type { Change } from '../commit/client'
import type { ExplorerClient } from './client'
import { createExplorerStore, gitOf } from './store'
import type { DirEntry } from './types'

const R = '/code/app'
const d = (name: string): DirEntry => ({ name, isDirectory: true })
const f = (name: string): DirEntry => ({ name, isDirectory: false })

type Pending = { resolve: (v: DirEntry[]) => void; reject: (e: unknown) => void }

/** A client whose listings come from `disk`, and whose reads can be held to answer out of order. */
function fakeClient(disk: Record<string, DirEntry[]>) {
  const reads: string[] = []
  const held = new Map<string, Pending[]>()
  let holding = false
  const client: ExplorerClient = {
    list: (dir) => {
      reads.push(dir)
      if (holding) return new Promise((resolve, reject) => held.set(dir, [...(held.get(dir) ?? []), { resolve, reject }]))
      const got = disk[dir]
      return got ? Promise.resolve(got) : Promise.reject(`${dir}: No such file or directory`)
    },
    changes: async () => [{ path: 'src/a.ts', origPath: null, index: '.', worktree: 'M', conflicted: false } satisfies Change],
    ignored: async () => ['dist/'],
    files: async () => ['src/a.ts', 'README.md'],
  }
  return {
    client,
    reads,
    hold: () => void (holding = true),
    held: (dir: string) => held.get(dir) ?? [],
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('the explorer store', () => {
  it('reads the worktree, the folders left open in it, and its git state', async () => {
    const fake = fakeClient({ [R]: [d('src'), f('README.md')], [`${R}/src`]: [f('a.ts')] })
    const s = createExplorerStore(fake.client)
    s.getState().expand(R, `${R}/src`)
    await flush()
    fake.reads.length = 0
    await s.getState().open(R)
    expect(fake.reads.sort()).toEqual([R, `${R}/src`])
    expect(s.getState().dirs[R]).toEqual([d('src'), f('README.md')])
    const git = gitOf(s.getState(), R)
    expect(Object.fromEntries(git.files)).toEqual({ 'src/a.ts': 'modified' })
    expect(Object.fromEntries(git.folders)).toEqual({ src: 'modified' })
    expect([...git.ignored]).toEqual(['dist'])
    expect(s.getState().prefs[R]).toEqual({ expanded: [`${R}/src`], showDotfiles: true, showIgnored: true })
  })

  it('marks a folder loading only the first time it is read', async () => {
    const fake = fakeClient({ [R]: [d('src')] })
    const s = createExplorerStore(fake.client)
    fake.hold()
    const first = s.getState().refresh(R)
    expect(s.getState().loading[R]).toBe(true)
    fake.held(R)[0].resolve([d('src')])
    await first
    expect(s.getState().loading[R]).toBeUndefined()
    void s.getState().refresh(R)
    expect(s.getState().loading[R]).toBeUndefined()
  })

  it('drops a reply to an older read of the same folder', async () => {
    const fake = fakeClient({})
    const s = createExplorerStore(fake.client)
    fake.hold()
    const a = s.getState().refresh(R)
    const b = s.getState().refresh(R)
    const [older, newer] = fake.held(R)
    newer.resolve([f('new.ts')])
    older.resolve([f('old.ts')])
    await Promise.all([a, b])
    expect(s.getState().dirs[R]).toEqual([f('new.ts')])
  })

  it('keeps the same listing object when a refresh reads the same entries', async () => {
    const fake = fakeClient({ [R]: [d('src'), f('a.ts')] })
    const s = createExplorerStore(fake.client)
    await s.getState().open(R)
    const before = s.getState().dirs
    await s.getState().refresh(R)
    expect(s.getState().dirs).toBe(before)
  })

  it('closes a folder that went away, and shows the error of a worktree that cannot be read', async () => {
    const fake = fakeClient({ [R]: [d('gone')] })
    const s = createExplorerStore(fake.client)
    s.getState().expand(R, `${R}/gone`)
    await flush()
    expect(s.getState().prefs[R].expanded).toEqual([])
    expect(s.getState().dirs[`${R}/gone`]).toBeUndefined()

    await s.getState().open('/code/missing')
    expect(s.getState().errors['/code/missing']).toContain('No such file')
  })

  it('toggles, collapses a subtree, collapses all, and reveals a file by opening the folders above it', async () => {
    const fake = fakeClient({ [R]: [d('src')], [`${R}/src`]: [d('ui')], [`${R}/src/ui`]: [f('b.tsx')], [`${R}/docs`]: [] })
    const s = createExplorerStore(fake.client)
    const st = () => s.getState()
    st().reveal(R, `${R}/src/ui/b.tsx`)
    expect(st().prefs[R].expanded).toEqual([`${R}/src`, `${R}/src/ui`])
    await flush()
    expect(st().dirs[`${R}/src/ui`]).toEqual([f('b.tsx')])
    st().reveal(R, `${R}/src/ui/b.tsx`)
    expect(st().prefs[R].expanded).toEqual([`${R}/src`, `${R}/src/ui`])

    st().toggle(R, `${R}/docs`)
    st().collapseSubtree(R, `${R}/src`)
    expect(st().prefs[R].expanded).toEqual([`${R}/docs`])
    st().toggle(R, `${R}/docs`)
    expect(st().prefs[R].expanded).toEqual([])
    st().expand(R, `${R}/src`)
    st().collapseAll(R)
    expect(st().prefs[R].expanded).toEqual([])
  })

  it("keeps each worktree's toggles apart", () => {
    const s = createExplorerStore(fakeClient({}).client)
    s.getState().setShowDotfiles(R, false)
    s.getState().setShowIgnored('/code/other', false)
    expect(s.getState().prefs[R]).toMatchObject({ showDotfiles: false, showIgnored: true })
    expect(s.getState().prefs['/code/other']).toMatchObject({ showDotfiles: true, showIgnored: false })
  })

  it('reads the file list once, and again on refresh', async () => {
    const fake = fakeClient({ [R]: [] })
    const files = vi.spyOn(fake.client, 'files')
    const s = createExplorerStore(fake.client)
    const reading = s.getState().loadFiles(R)
    expect(s.getState().files[R]).toEqual({ paths: null, error: null })
    await reading
    expect(s.getState().files[R]).toEqual({ paths: ['src/a.ts', 'README.md'], error: null })
    await s.getState().loadFiles(R)
    expect(files).toHaveBeenCalledTimes(1)
    await s.getState().refresh(R)
    expect(files).toHaveBeenCalledTimes(2)
  })

  it("draws the tree undecorated when git can't say", async () => {
    const fake = fakeClient({ [R]: [] })
    fake.client.changes = () => Promise.reject(new Error('not a git repository'))
    fake.client.ignored = () => Promise.reject(new Error('not a git repository'))
    const s = createExplorerStore(fake.client)
    await s.getState().open(R)
    expect(gitOf(s.getState(), R).files.size).toBe(0)
  })
})
