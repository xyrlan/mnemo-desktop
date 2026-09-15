import { createHomeStore } from './store'
import type { HomeClient } from './client'
import type { HomeSnapshot } from './types'

const snap: HomeSnapshot = {
  repos: [
    { root: '/gh/a', name: 'a', last_at: 2, pinned: false, hidden: false, sessions: [{ id: 's1', title: 'one', cwd: '/gh/a', last_at: 2, transcript: true, live: null, kind: 'interactive' }] },
    { root: '/gh/b', name: 'b', last_at: 1, pinned: false, hidden: false, sessions: [] },
  ],
  clone_base: '/gh',
  errors: [],
}

function mk(over: Partial<HomeClient> = {}) {
  const calls: string[] = []
  const client: HomeClient = {
    // Like the Rust side: roots opened this run come back as (empty) repos.
    snapshot: async (a) => ({
      ...snap,
      repos: [...snap.repos, ...a.extraRoots.map((root) => ({ root, name: root.split('/').pop()!, last_at: 0, pinned: false, hidden: false, sessions: [] }))],
    }),
    registerRepo: async (p) => p,
    pickFolder: async () => '/gh/picked',
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
  expect(store.getState().notice).toBe('aberta em outro terminal')
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
  const bad = mk({ registerRepo: async () => { throw 'não é um repositório git' } })
  await bad.store.getState().load()
  await bad.store.getState().openFolder()
  expect(bad.store.getState().notice).toBe('não é um repositório git')
  const ok = mk()
  await ok.store.getState().load()
  await ok.store.getState().openFolder()
  expect(ok.store.getState().extraRoots).toEqual(['/gh/picked'])
  expect(ok.store.getState().selected).toBe('/gh/picked')
})
