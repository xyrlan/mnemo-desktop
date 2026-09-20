import { createHomeStore } from './store'
import type { HomeClient } from './client'
import type { LensClient } from './store'
import type { HomeSnapshot } from './types'

const snap: HomeSnapshot = {
  repos: [
    { root: '/gh/a', name: 'a', last_at: 2, pinned: false, hidden: false, unresolved: false, sessions: [{ id: 's1', title: 'one', cwd: '/gh/a', last_at: 2, transcript: true, live: null, kind: 'interactive', agent: null }], children: [] },
    { root: '/gh/b', name: 'b', last_at: 1, pinned: false, hidden: false, unresolved: false, sessions: [], children: [] },
  ],
  clone_base: '/gh',
  errors: [],
  protected: 0,
}

function mk(over: Partial<LensClient> = {}) {
  const calls: string[] = []
  const client: LensClient = {
    // Like the Rust side: roots opened this run come back as (empty) repos.
    // Like the Rust side: the flags come back applied from the arguments, and repos are
    // sorted pinned first, then by last activity, then by name (`sort_repos` in home.rs).
    snapshot: async (a) => ({
      ...snap,
      repos: [...snap.repos, ...a.extraRoots.map((root) => ({ root, name: root.split('/').pop()!, last_at: 0, pinned: false, hidden: false, unresolved: false, sessions: [], children: [] }))]
        .map((r) => ({ ...r, pinned: a.pinned.includes(r.root), hidden: a.hidden.includes(r.root) }))
        .sort((x, y) => Number(y.pinned) - Number(x.pinned) || y.last_at - x.last_at || x.name.localeCompare(y.name)),
    }),
    registerRepo: async (p) => p,
    resolveRepo: async (p) => p,
    pickFolder: async () => '/gh/picked',
    refreshGithub: async () => {},
    ...over,
  }
  const settings = { homePinned: [] as string[], homeHidden: [] as string[], cloneBase: null as string | null }
  const setSetting = async (k: 'homePinned' | 'homeHidden', v: string[]) => { settings[k] = v; calls.push(`${k}=${v.join(',')}`) }
  const layout = {
    panes: {} as Record<number, { id: number; sessionId?: string }>,
    commands: [] as string[],
    focused: [] as number[],
    openCommandTab: async (cwd: string | undefined, cmd: string) => { layout.commands.push(`${cwd}:${cmd}`) },
    newTab: async (cwd?: string) => { layout.commands.push(`${cwd}:shell`) },
    focusPane: (id: number) => { layout.focused.push(id) },
  }
  const store = createHomeStore(client, () => settings, setSetting, layout)
  return { store, calls, layout }
}

test('load selects the first repo and keeps selection across reloads', async () => {
  const { store } = mk()
  await store.getState().load()
  expect(store.getState().selected).toBe('/gh/a')
  store.getState().select('/gh/b')
  await store.getState().load()
  expect(store.getState().selected).toBe('/gh/b')
})

test('load passes the sessions this window runs as `here`', async () => {
  let seen: string[] = []
  const { store, layout } = mk({ snapshot: async (a) => { seen = a.here; return snap } })
  layout.panes[2] = { id: 2, sessionId: 's1' }
  layout.panes[3] = { id: 3 }
  await store.getState().load()
  expect(seen).toEqual(['s1'])
})

test('pin and hide toggle the settings arrays', async () => {
  const { store, calls } = mk()
  await store.getState().load()
  await store.getState().togglePin('/gh/a')
  await store.getState().toggleHidden('/gh/a')
  expect(calls).toEqual(['homePinned=/gh/a', 'homeHidden=/gh/a'])
  await store.getState().togglePin('/gh/a')
  expect(calls.at(-1)).toBe('homePinned=')
})

test('openSession resumes a dead session in the repo root; newSession and shell open tabs', async () => {
  const { store, layout } = mk()
  await store.getState().load()
  store.getState().openSession(snap.repos[0], snap.repos[0].sessions[0])
  store.getState().newSession('/gh/b')
  store.getState().shell('/gh/b')
  expect(layout.commands).toEqual(['/gh/a:claude --resume s1', '/gh/b:claude', '/gh/b:shell'])
})

test('openSession with a live-here session focuses its pane; elsewhere only notices', async () => {
  const { store, layout } = mk()
  layout.panes[4] = { id: 4, sessionId: 's1' }
  await store.getState().load()
  store.getState().openSession(snap.repos[0], { ...snap.repos[0].sessions[0], live: 'here' })
  expect(layout.focused).toEqual([4])
  store.getState().openSession(snap.repos[0], { ...snap.repos[0].sessions[0], id: 's9', live: 'elsewhere' })
  expect(layout.commands).toEqual([])
  expect(store.getState().notice).toBe('open in another terminal')
})

test('clone types gh into a tab under clone_base and remembers the dest as an extra root', async () => {
  const { store, layout } = mk()
  await store.getState().load()
  store.getState().setCloneSpec('xyrlan/mnemo')
  await store.getState().clone()
  expect(layout.commands).toEqual(['/gh:gh repo clone xyrlan/mnemo /gh/mnemo'])
  expect(store.getState().extraRoots).toEqual(['/gh/mnemo'])
  expect(store.getState().cloneSpec).toBe('')
})

test('openFolder registers the picked dir and refreshes; non-git surfaces the error', async () => {
  const bad = mk({ registerRepo: async () => { throw 'not a git repository' } })
  await bad.store.getState().load()
  await bad.store.getState().openFolder()
  expect(bad.store.getState().notice).toBe('not a git repository')
  const ok = mk()
  await ok.store.getState().load()
  await ok.store.getState().openFolder()
  expect(ok.store.getState().extraRoots).toEqual(['/gh/picked'])
  expect(ok.store.getState().selected).toBe('/gh/picked')
})

/** `/dl/x-sub` sits in a protected folder: listed by its history path until selected. */
function mkProtected(resolveRepo: HomeClient['resolveRepo']) {
  let resolved = false
  const resolves: string[] = []
  const locked = { root: '/dl/x-sub', name: 'x-sub', last_at: 9, pinned: false, hidden: false, unresolved: true, sessions: [], children: [] }
  const t = mk({
    snapshot: async () => ({ ...snap, repos: resolved ? snap.repos : [locked, ...snap.repos] }),
    resolveRepo: async (root) => {
      resolves.push(root)
      const r = await resolveRepo(root)
      resolved = true
      return r
    },
  })
  return { ...t, resolves }
}

test('load never resolves: it lists unresolved repos and prefers a resolved one for the default selection', async () => {
  const { store, resolves } = mkProtected(async () => '/gh/a')
  await store.getState().load()
  await store.getState().load()
  expect(resolves).toEqual([])
  expect(store.getState().snapshot.repos[0].unresolved).toBe(true)
  expect(store.getState().selected).toBe('/gh/a')
})

test('load never selects an unresolved repo, even when it is the only one', async () => {
  const locked = { ...snap.repos[1], root: '/dl/only', name: 'only', unresolved: true }
  const { store } = mk({ snapshot: async () => ({ ...snap, repos: [locked], protected: 1 }) })
  await store.getState().load()
  expect(store.getState().selected).toBeNull()
  store.getState().setShowProtected(true)
  expect(store.getState().showProtected).toBe(true)
})

test('selecting an unresolved repo resolves it once and selects the resolved root', async () => {
  const { store, resolves } = mkProtected(async () => '/gh/a')
  await store.getState().load()
  await store.getState().select('/dl/x-sub')
  expect(resolves).toEqual(['/dl/x-sub'])
  expect(store.getState().selected).toBe('/gh/a')
  expect(store.getState().snapshot.repos.some((r) => r.unresolved)).toBe(false)
  await store.getState().select('/gh/b')
  expect(resolves).toEqual(['/dl/x-sub'])
})

test('a failed resolve surfaces the error', async () => {
  const { store } = mkProtected(async () => { throw 'not a git repository' })
  await store.getState().load()
  await store.getState().select('/dl/x-sub')
  expect(store.getState().notice).toBe('not a git repository')
})

test('refreshGithub reads GitHub, then reloads the snapshot that carries it', async () => {
  const order: string[] = []
  let fetched = false
  const pr = { number: 7, title: 't', state: 'open' as const, checks: 'none' as const, child: null, url: 'u' }
  const { store } = mk({
    refreshGithub: async () => { order.push('gh'); fetched = true },
    snapshot: async () => { order.push('snapshot'); return { ...snap, repos: snap.repos.map((r) => ({ ...r, prs: fetched ? [pr] : [] })) } },
  })
  expect(store.getState().github).toBe('idle')
  await store.getState().load()
  const p = store.getState().refreshGithub()
  expect(store.getState().github).toBe('loading')
  await p
  expect(order).toEqual(['snapshot', 'gh', 'snapshot'])
  expect(store.getState().github).toBe('ready')
  expect(store.getState().githubAt).not.toBeNull()
  expect(store.getState().snapshot.repos[0].prs).toEqual([pr])
})

test('refreshGithub while one runs is dropped; a failure is a notice and keeps the lists', async () => {
  let calls = 0
  let release = () => {}
  const { store } = mk({ refreshGithub: () => { calls++; return new Promise<void>((r) => { release = r }) } })
  const first = store.getState().refreshGithub()
  await store.getState().refreshGithub()
  expect(calls).toBe(1)
  release()
  await first
  const failing = mk({ refreshGithub: async () => { throw 'gh: not logged in' } })
  await failing.store.getState().refreshGithub()
  expect(failing.store.getState().notice).toBe('gh: not logged in')
  expect(failing.store.getState().github).toBe('idle')
})

test('load alone never reads GitHub', async () => {
  let calls = 0
  const { store } = mk({ refreshGithub: async () => { calls++ } })
  await store.getState().load()
  await store.getState().load()
  expect(calls).toBe(0)
})

test('a toggle shows in the snapshot at once, without waiting for a reload', async () => {
  // The real snapshot reads history.jsonl, runs `claude agents` and probes git per cwd. A
  // toggle only moves a repo in a list already on screen, so it must not wait for any of it.
  const held: Array<() => void> = []
  let snapshots = 0
  const { store } = mk({
    snapshot: async () => {
      snapshots++
      if (snapshots > 1) await new Promise<void>((res) => held.push(res))
      return snap
    },
  })
  await store.getState().load()

  const pin = store.getState().togglePin('/gh/a')
  expect(store.getState().snapshot.repos.find((r) => r.root === '/gh/a')!.pinned).toBe(true)
  // Let the reload the toggle started finish, so nothing is left pending.
  await Promise.resolve()
  held.forEach((r) => r())
  await pin
})

test('pinning reorders the list the way the backend sorts it', async () => {
  const { store } = mk()
  await store.getState().load()
  expect(store.getState().snapshot.repos.map((r) => r.root)).toEqual(['/gh/a', '/gh/b'])
  await store.getState().togglePin('/gh/b')
  // Pinned first, then by last activity: /gh/b jumps the newer /gh/a.
  expect(store.getState().snapshot.repos.map((r) => r.root)).toEqual(['/gh/b', '/gh/a'])
})

const aPr = { number: 372, title: 'the PR view', state: 'open' as const, checks: 'none' as const, child: 'cccc1111', url: 'https://gh/o/a/pull/372' }

test('openPr pushes a PR over the stream and closePr pops it; nothing else moves', async () => {
  const { store } = mk()
  await store.getState().load()
  expect(store.getState().openedPr).toBeNull()
  store.getState().openPr('/gh/a', aPr)
  expect(store.getState().openedPr).toEqual({ repo: '/gh/a', pr: aPr })
  // The stream is untouched underneath: same snapshot, same selection.
  expect(store.getState().selected).toBe('/gh/a')
  store.getState().openPr('/gh/b', { ...aPr, number: 9 })
  expect(store.getState().openedPr?.pr.number).toBe(9)
  store.getState().closePr()
  expect(store.getState().openedPr).toBeNull()
})

test('a reload leaves an open PR open: the view reads the fresh one out of the snapshot', async () => {
  const { store } = mk()
  store.getState().openPr('/gh/a', aPr)
  await store.getState().load()
  expect(store.getState().openedPr).toEqual({ repo: '/gh/a', pr: aPr })
})

test('stopChild types `claude stop` in a terminal tab in the repo', async () => {
  const { store, layout } = mk()
  await store.getState().load()
  const repo = store.getState().snapshot.repos[0]
  store.getState().stopChild(repo, repo.sessions[0])
  expect(layout.commands).toEqual(['/gh/a:claude stop s1'])
})
