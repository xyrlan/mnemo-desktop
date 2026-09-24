import type { ScmClient, ScmStatus } from './client'
import { createScmStore } from './store'

const WT = '/code/app-wt-feat'
const status = (paths: string[]): ScmStatus => ({
  root: WT,
  branch: 'feat',
  truncated: false,
  entries: paths.map((path) => ({ path, oldPath: null, area: 'unstaged', status: 'modified', added: 1, removed: 0 })),
})

/** A client whose every call waits until the test lets it answer. */
function fakeClient() {
  const calls: [string, unknown[]][] = []
  const waiting: { cmd: string; resolve(v: unknown): void; reject(e: unknown): void }[] = []
  const call = (cmd: string) => (...args: unknown[]) =>
    new Promise<never>((resolve, reject) => {
      calls.push([cmd, args])
      waiting.push({ cmd, resolve: resolve as (v: unknown) => void, reject })
    })
  const client = {
    status: call('status'),
    stage: call('stage'),
    unstage: call('unstage'),
    discard: call('discard'),
    watch: call('watch'),
    onChanged: async () => () => {},
  } as unknown as ScmClient
  /** Answers the oldest call to `cmd` still waiting. */
  const answer = async (cmd: string, value?: unknown, fail = false) => {
    const i = waiting.findIndex((w) => w.cmd === cmd)
    if (i < 0) throw new Error(`no ${cmd} waiting`)
    const [w] = waiting.splice(i, 1)
    if (fail) w.reject(value)
    else w.resolve(value)
    await new Promise((r) => setTimeout(r, 0))
  }
  return { client, calls, answer, waiting }
}

it('reads a tree, and keeps what it read while reading again', async () => {
  const f = fakeClient()
  const store = createScmStore(f.client)
  void store.getState().load(WT)
  expect(store.getState().trees[WT]).toEqual({ status: null, loading: true, error: null })
  await f.answer('status', status(['a.ts']))
  expect(store.getState().trees[WT]).toEqual({ status: status(['a.ts']), loading: false, error: null })
  void store.getState().load(WT)
  expect(store.getState().trees[WT]?.status).toEqual(status(['a.ts']))
  await f.answer('status', 'fatal: not a git repository', true)
  expect(store.getState().trees[WT]).toEqual({ status: status(['a.ts']), loading: false, error: 'fatal: not a git repository' })
})

it('drops a reply that lands after a newer read of the same tree', async () => {
  const f = fakeClient()
  const store = createScmStore(f.client)
  void store.getState().load(WT)
  void store.getState().load(WT)
  await f.answer('status', status(['old.ts']))
  expect(store.getState().trees[WT]?.status).toBeNull()
  await f.answer('status', status(['new.ts']))
  expect(store.getState().trees[WT]?.status).toEqual(status(['new.ts']))
})

it('a step runs, then reads the tree again, busy until both are done', async () => {
  const f = fakeClient()
  const store = createScmStore(f.client)
  const done = store.getState().stage(WT, ['a.ts', 'b c.ts'])
  expect(store.getState().busy[WT]).toBe(true)
  expect(f.calls).toEqual([['stage', [WT, ['a.ts', 'b c.ts']]]])
  await f.answer('stage')
  expect(f.calls.at(-1)).toEqual(['status', [WT]])
  expect(store.getState().busy[WT]).toBe(true)
  await f.answer('status', status([]))
  await done
  expect(store.getState().busy[WT]).toBe(false)
  expect(store.getState().failed[WT]).toBeNull()
})

it('a step that fails says why, and still reads the tree again', async () => {
  const f = fakeClient()
  const store = createScmStore(f.client)
  const done = store.getState().discard(WT, ['a.ts'], ['n.txt'])
  expect(f.calls).toEqual([['discard', [WT, ['a.ts'], ['n.txt']]]])
  await f.answer('discard', 'n.txt: git does not list it as untracked', true)
  await f.answer('status', status(['a.ts']))
  await done
  expect(store.getState().failed[WT]).toBe('n.txt: git does not list it as untracked')
  expect(store.getState().busy[WT]).toBe(false)
  store.getState().dismiss(WT)
  expect(store.getState().failed[WT]).toBeNull()
})

it('stays busy until the last of two steps is done', async () => {
  const f = fakeClient()
  const store = createScmStore(f.client)
  const one = store.getState().stage(WT, ['a.ts'])
  const two = store.getState().unstage(WT, ['b.ts', 'old b.ts'])
  await f.answer('stage')
  await f.answer('status', status([]))
  await one
  expect(store.getState().busy[WT]).toBe(true)
  await f.answer('unstage')
  await f.answer('status', status([]))
  await two
  expect(store.getState().busy[WT]).toBe(false)
  expect(f.calls.filter(([c]) => c === 'unstage')).toEqual([['unstage', [WT, ['b.ts', 'old b.ts']]]])
})
