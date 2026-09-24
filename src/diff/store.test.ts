import { createDiffStore, readKept, sidesKey, STORAGE_KEY, type DiffDeps } from './store'
import type { ChangeList, FileSides } from './client'
import type { Target } from './deliver'
import { formatDiffComments } from './format'

const WT = '/code/app'
const LIST: ChangeList = {
  root: WT,
  truncated: false,
  files: [{ path: 'a.ts', oldPath: null, status: 'modified', additions: 1, deletions: 1, binary: false }],
}
const SIDES: FileSides = { original: 'a\n', modified: 'b\n', binary: false, tooLarge: false }

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function setup(over: Partial<DiffDeps> = {}) {
  const sent: string[] = []
  const memory = new Map<string, string>()
  let target: Target | null = { kind: 'mission', id: 'c1', label: 'the child' }
  let n = 0
  const deps: DiffDeps = {
    client: { files: async () => LIST, sides: async () => SIDES },
    target: () => target,
    deliver: {
      reply: async (id, text) => void sent.push(`${id}: ${text}`),
      write: async () => {},
      sleep: async () => {},
    },
    storage: { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => void memory.set(k, v) },
    now: () => 1000 + n,
    newId: () => `n${++n}`,
    ...over,
  }
  const store = createDiffStore(deps)
  return { store, sent, memory, setTarget: (t: Target | null) => (target = t) }
}

const add = (s: ReturnType<typeof setup>['store'], over: { filePath?: string; lineNumber?: number; worktreeId?: string; body?: string } = {}) =>
  s.getState().addComment({ worktreeId: WT, filePath: 'a.ts', lineNumber: 1, body: 'fix this', ...over })

test('load reads the change list; a failed read keeps the last one with the reason', async () => {
  let fail = false
  const { store } = setup({
    client: {
      files: async () => {
        if (fail) throw 'git broke'
        return LIST
      },
      sides: async () => SIDES,
    },
  })
  await store.getState().load(WT)
  expect(store.getState().changes[WT]).toEqual({ list: LIST, loading: false, error: null })
  fail = true
  await store.getState().load(WT)
  expect(store.getState().changes[WT]).toEqual({ list: LIST, loading: false, error: 'git broke' })
})

test('a reply that lands after a newer read is dropped', async () => {
  const first = deferred<ChangeList>()
  const second = deferred<ChangeList>()
  const replies = [first, second]
  const { store } = setup({ client: { files: () => replies.shift()!.promise, sides: async () => SIDES } })
  const a = store.getState().load(WT)
  const b = store.getState().load(WT)
  const newer = { ...LIST, files: [] }
  second.resolve(newer)
  await b
  first.resolve(LIST)
  await a
  expect(store.getState().changes[WT].list).toBe(newer)
})

test('sides are read once, again when forced, and forgotten when the list is read again', async () => {
  let reads = 0
  const { store } = setup({ client: { files: async () => LIST, sides: async () => (reads++, SIDES) } })
  await store.getState().loadSides(WT, 'a.ts', null)
  await store.getState().loadSides(WT, 'a.ts', null)
  expect(reads).toBe(1)
  expect(store.getState().sides[sidesKey(WT, 'a.ts')].data).toBe(SIDES)
  await store.getState().loadSides(WT, 'a.ts', null, true)
  expect(reads).toBe(2)
  await store.getState().loadSides('/other', 'a.ts', null)
  await store.getState().load(WT)
  expect(store.getState().sides[sidesKey(WT, 'a.ts')]).toBeUndefined()
  expect(store.getState().sides[sidesKey('/other', 'a.ts')]).toBeDefined()
})

test('a failed sides read carries the reason', async () => {
  const { store } = setup({ client: { files: async () => LIST, sides: async () => Promise.reject('no such file') } })
  await store.getState().loadSides(WT, 'a.ts', null)
  expect(store.getState().sides[sidesKey(WT, 'a.ts')]).toEqual({ data: null, loading: false, error: 'no such file' })
})

test('notes are added, edited and deleted, and kept in storage between launches', () => {
  const { store, memory } = setup()
  const a = add(store)
  add(store, { lineNumber: 5, body: 'and this' })
  store.getState().updateComment(a.id, 'fix this, please')
  expect(store.getState().comments.map((c) => c.body)).toEqual(['fix this, please', 'and this'])
  store.getState().deleteComment(a.id)
  expect(readKept(memory.get(STORAGE_KEY) ?? null).map((c) => c.body)).toEqual(['and this'])

  const again = setup({ storage: { getItem: () => memory.get(STORAGE_KEY) ?? null, setItem: () => {} } })
  expect(again.store.getState().comments.map((c) => c.body)).toEqual(['and this'])
})

test('readKept drops what is malformed', () => {
  expect(readKept('not json')).toEqual([])
  expect(readKept('{"a":1}')).toEqual([])
  const ok = { id: 'x', worktreeId: WT, filePath: 'a', lineNumber: 1, body: 'b', createdAt: 1 }
  expect(readKept(JSON.stringify([ok, { ...ok, lineNumber: '1' }, null]))).toEqual([ok])
})

test('send delivers every note of the worktree in one message and drops them', async () => {
  const { store, sent } = setup()
  add(store, { body: 'one' })
  add(store, { lineNumber: 3, body: 'two' })
  add(store, { worktreeId: '/elsewhere', body: 'not this tree' })
  const notes = store.getState().comments.filter((c) => c.worktreeId === WT)
  expect(await store.getState().send(WT)).toBe(true)
  expect(sent).toEqual([`c1: ${formatDiffComments(notes)}`])
  expect(store.getState().comments.map((c) => c.body)).toEqual(['not this tree'])
  expect(store.getState().sent[WT]).toEqual({ sending: false, ok: 'Sent 2 notes to the child.', error: null })
})

test('send with ids sends only those', async () => {
  const { store, sent } = setup()
  add(store, { body: 'one' })
  const two = add(store, { body: 'two' })
  await store.getState().send(WT, [two.id])
  expect(sent).toHaveLength(1)
  expect(sent[0]).toContain('two')
  expect(sent[0]).not.toContain('one')
  expect(store.getState().comments.map((c) => c.body)).toEqual(['one'])
})

test('with no agent, or a failed delivery, nothing is dropped and the reason shows', async () => {
  const { store, setTarget } = setup({ deliver: { reply: async () => Promise.reject('socket gone'), write: async () => {} } })
  add(store)
  expect(await store.getState().send('/elsewhere')).toBe(false)
  expect(store.getState().sent['/elsewhere'].error).toBe('No notes to send.')

  setTarget(null)
  expect(await store.getState().send(WT)).toBe(false)
  expect(store.getState().sent[WT].error).toMatch(/^No agent runs in this worktree/)

  setTarget({ kind: 'mission', id: 'c1', label: 'the child' })
  expect(await store.getState().send(WT)).toBe(false)
  expect(store.getState().sent[WT].error).toBe('Could not send to the child: socket gone')
  expect(store.getState().comments).toHaveLength(1)
})

test('a pane target gets the message pasted, then Enter', async () => {
  const writes: string[] = []
  const { store: paneStore } = setup({
    target: () => ({ kind: 'pane', pane: 4, label: 'Claude' }),
    deliver: { reply: async () => {}, write: async (_p, d) => void writes.push(d), sleep: async () => {} },
  })
  add(paneStore, { body: 'look here' })
  await paneStore.getState().send(WT)
  expect(writes).toHaveLength(2)
  expect(writes[0]).toContain('look here')
  expect(writes[1]).toBe('\r')
})
