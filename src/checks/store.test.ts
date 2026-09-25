import { expect, test } from 'vitest'
import type { CheckDetails, ChecksClient, ChecksView, MergeMethod, Merged } from './client'
import { GREEN, PR, UBUNTU, VIEW, WINDOWS, WINDOWS_DETAILS, WT, check } from './fixtures'
import { createChecksStore, FIX_JOBS } from './store'

type Calls = string[]

/** A client whose answers the test hands out: each call waits until `answer` is given. */
function fake() {
  const calls: Calls = []
  const pending: { name: string; resolve(v: unknown): void; reject(e: unknown): void }[] = []
  const wait = <T,>(name: string) =>
    new Promise<T>((resolve, reject) => {
      calls.push(name)
      pending.push({ name, resolve: resolve as (v: unknown) => void, reject })
    })
  const client: ChecksClient = {
    read: (wt) => wait<ChecksView>(`read ${wt}`),
    details: (_wt, url) => wait<CheckDetails>(`details ${url}`),
    merge: (_wt, n, method: MergeMethod, sha) => wait<Merged>(`merge ${n} ${method} ${sha}`),
    ready: (_wt, n) => wait<void>(`ready ${n}`),
  }
  const take = (name: string, last = false) => {
    const i = last ? pending.map((p) => p.name).lastIndexOf(name) : pending.findIndex((p) => p.name === name)
    if (i < 0) throw new Error(`nothing is waiting on ${name}; waiting: ${pending.map((p) => p.name).join(', ')}`)
    return pending.splice(i, 1)[0]
  }
  const flush = () => new Promise((r) => setTimeout(r, 0))
  return {
    client,
    calls,
    answer: async (name: string, v: unknown) => {
      take(name).resolve(v)
      await flush()
    },
    /** Answers the most recent call named `name`, ahead of older ones. */
    answerLast: async (name: string, v: unknown) => {
      take(name, true).resolve(v)
      await flush()
    },
    refuse: async (name: string, e: unknown) => {
      take(name).reject(e)
      await flush()
    },
    flush,
  }
}

test('a read shows the view; a failed read keeps the last one under its error', async () => {
  const f = fake()
  const store = createChecksStore(f.client, () => 1000)
  const p = store.getState().load(WT)
  expect(store.getState().trees[WT]).toMatchObject({ loading: true, view: null })
  await f.answer(`read ${WT}`, VIEW)
  await p
  expect(store.getState().trees[WT]).toEqual({ view: VIEW, loading: false, error: null, at: 1000 })

  const again = store.getState().load(WT)
  await f.refuse(`read ${WT}`, 'gh: HTTP 502')
  await again
  expect(store.getState().trees[WT]).toMatchObject({ view: VIEW, loading: false, error: 'gh: HTTP 502' })
})

test('a reply overtaken by a newer read is dropped, and each worktree keeps its own', async () => {
  const f = fake()
  const store = createChecksStore(f.client)
  const first = store.getState().load(WT)
  const second = store.getState().load(WT)
  const other = store.getState().load('/code/other')
  expect(f.calls.filter((c) => c === `read ${WT}`).length).toBe(2)
  // The newer read answers first; the older one lands late, with what was true before.
  await f.answerLast(`read ${WT}`, VIEW)
  await f.answer(`read ${WT}`, { ...VIEW, pr: { ...PR, title: 'old' } })
  await f.answer('read /code/other', GREEN)
  await Promise.all([first, second, other])
  expect(store.getState().trees[WT].view?.pr?.title).toBe(PR.title)
  expect(store.getState().trees[WT].loading).toBe(false)
  expect(store.getState().trees['/code/other'].view).toBe(GREEN)
})

test('a read younger than maxAgeMs is not made again', async () => {
  const f = fake()
  let now = 1000
  const store = createChecksStore(f.client, () => now)
  const p = store.getState().load(WT)
  await f.answer(`read ${WT}`, VIEW)
  await p
  now = 3000
  await store.getState().load(WT, { maxAgeMs: 5000 })
  expect(f.calls).toEqual([`read ${WT}`])
  now = 7000
  void store.getState().load(WT, { maxAgeMs: 5000 })
  expect(f.calls).toEqual([`read ${WT}`, `read ${WT}`])
})

test('a check’s job is read once per state, and two asks share one read', async () => {
  const f = fake()
  const store = createChecksStore(f.client)
  const a = store.getState().loadDetails(WT, WINDOWS)
  const b = store.getState().loadDetails(WT, WINDOWS)
  expect(f.calls).toEqual([`details ${WINDOWS.url}`])
  await f.answer(`details ${WINDOWS.url}`, WINDOWS_DETAILS)
  expect(await a).toEqual({ loading: false, details: WINDOWS_DETAILS, error: null })
  expect(await b).toBe(await a)
  await store.getState().loadDetails(WT, WINDOWS)
  expect(f.calls.length).toBe(1)

  // The running check finishes: its details are read again.
  void store.getState().loadDetails(WT, UBUNTU)
  await f.answer(`details ${UBUNTU.url}`, { ...WINDOWS_DETAILS, status: 'in_progress', conclusion: null })
  void store.getState().loadDetails(WT, { ...UBUNTU, status: 'completed', conclusion: 'failure' })
  expect(f.calls.filter((c) => c === `details ${UBUNTU.url}`).length).toBe(2)
})

test('a failed details read says why and is tried again on the next ask', async () => {
  const f = fake()
  const store = createChecksStore(f.client)
  const a = store.getState().loadDetails(WT, WINDOWS)
  await f.refuse(`details ${WINDOWS.url}`, 'gh: Not Found (HTTP 404)')
  expect(await a).toEqual({ loading: false, details: null, error: 'gh: Not Found (HTTP 404)' })
  void store.getState().loadDetails(WT, WINDOWS)
  expect(f.calls.length).toBe(2)
})

async function shown(f: ReturnType<typeof fake>, view: ChecksView = GREEN) {
  const store = createChecksStore(f.client)
  const p = store.getState().load(WT)
  await f.answer(`read ${WT}`, view)
  await p
  f.calls.length = 0
  return store
}

test('a merge lands the head that was shown, then reads the PR again', async () => {
  const f = fake()
  const store = await shown(f)
  const m = store.getState().merge(WT, 'squash')
  expect(store.getState().busy[WT]).toEqual({ kind: 'merge' })
  expect(f.calls).toEqual([`merge 240 squash ${PR.headSha}`])
  // Nothing else starts while it runs.
  await expect(store.getState().ready(WT)).rejects.toThrow('Something else is still running')
  await f.answer(`merge 240 squash ${PR.headSha}`, { merged: true, message: 'Merged PR #240' })
  await f.answer(`read ${WT}`, { ...GREEN, pr: { ...PR, state: 'merged' } })
  expect(await m).toEqual({ merged: true, message: 'Merged PR #240' })
  expect(store.getState().busy[WT]).toBeNull()
  expect(store.getState().trees[WT].view?.pr?.state).toBe('merged')
})

test('a refused merge rejects with gh’s reason and still reads the PR again', async () => {
  const f = fake()
  const store = await shown(f)
  const m = store.getState().merge(WT, 'rebase')
  const caught = m.catch((e) => e)
  await f.refuse(`merge 240 rebase ${PR.headSha}`, 'Not merged: 1 check failed: win')
  await f.answer(`read ${WT}`, GREEN)
  expect(await caught).toBe('Not merged: 1 check failed: win')
  expect(store.getState().busy[WT]).toBeNull()
})

test('ready marks the PR shown and reads it again; with no PR shown nothing is asked', async () => {
  const f = fake()
  const store = await shown(f, { ...GREEN, pr: { ...PR, state: 'draft' } })
  const r = store.getState().ready(WT)
  await f.answer('ready 240', undefined)
  await f.answer(`read ${WT}`, GREEN)
  await r
  expect(f.calls).toEqual(['ready 240', `read ${WT}`])

  const empty = createChecksStore(fake().client)
  expect(() => empty.getState().merge(WT, 'squash')).toThrow('No pull request is shown')
})

test('Fix reads the failing checks’ jobs, at most FIX_JOBS of them, and builds one prompt', async () => {
  const f = fake()
  const failing = Array.from({ length: FIX_JOBS + 2 }, (_, i) => check({ name: `job ${i}`, verdict: 'fail', conclusion: 'failure', url: `https://github.com/o/app/actions/runs/1/job/${i}`, jobId: i + 1 }))
  const external = check({ name: 'buildkite', verdict: 'fail', conclusion: 'failure', url: 'https://buildkite.com/x' })
  const store = await shown(f, { ...VIEW, checks: [...failing, external, UBUNTU] })
  const text = store.getState().fixText(WT)
  await f.flush()
  expect(f.calls).toEqual(failing.slice(0, FIX_JOBS).map((c) => `details ${c.url}`))
  for (const c of failing.slice(0, FIX_JOBS)) await f.answer(`details ${c.url}`, { ...WINDOWS_DETAILS, name: c.name })
  const prompt = await text
  expect(prompt).toContain('## job 0: failed')
  expect(prompt).toContain(`## job ${FIX_JOBS + 1}: failed`)
  expect(prompt).toContain('## buildkite: failed')
  expect(prompt).not.toContain('test (ubuntu-latest)')
  expect(prompt.match(/Log tail:/g)?.length).toBe(FIX_JOBS)

  const green = await shown(fake(), GREEN)
  await expect(green.getState().fixText(WT)).rejects.toThrow('No check is failing')
})

test('sends to the agent run one at a time per worktree', async () => {
  const f = fake()
  const store = await shown(f)
  let deliver!: (v: { title: string; started: boolean }) => void
  const sent: string[] = []
  const first = store.getState().send(WT, 'fix', () => 'the prompt', (text) => {
    sent.push(text)
    return new Promise((r) => (deliver = r))
  })
  await f.flush()
  expect(store.getState().busy[WT]).toEqual({ kind: 'send', id: 'fix' })
  await expect(store.getState().send(WT, 'PRRT_1', () => 'other', async () => ({ title: 'x', started: false }))).rejects.toThrow('Something else is still running')
  deliver({ title: 'fix the header', started: false })
  expect(await first).toEqual({ title: 'fix the header', started: false })
  expect(sent).toEqual(['the prompt'])
  expect(store.getState().busy[WT]).toBeNull()
  // A send reads nothing again: it changed nothing on GitHub.
  expect(f.calls).toEqual([])
})
