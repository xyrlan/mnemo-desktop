import { vi } from 'vitest'
import { createStore } from './store'
import { registerReuse } from './reuse'
import type { PtyClient } from '../pty/client'

function fakePty(opts: { failSpawn?: boolean; promptBeforeResolve?: boolean } = {}): PtyClient & { killed: number[]; outputs: Record<number, (b: Uint8Array) => void> } {
  let next = 1
  const killed: number[] = []
  const outputs: Record<number, (b: Uint8Array) => void> = {}
  return {
    killed,
    outputs,
    spawn: async ({ onOutput }) => {
      if (opts.failSpawn) throw new Error('boom')
      const id = next++
      outputs[id] = onOutput
      if (opts.promptBeforeResolve) onOutput(new Uint8Array([36, 32])) // "$ " before invoke resolves
      return id
    },
    write: async () => {},
    resize: async () => {},
    kill: async (id) => {
      killed.push(id)
    },
    onExit: async () => () => {},
  }
}

test('boot creates one tab with one pane', async () => {
  const s = createStore(fakePty())
  await s.getState().newTab()
  const st = s.getState()
  expect(st.tabs).toHaveLength(1)
  expect(st.tabs[0].root).toEqual({ kind: 'leaf', pane: 1 })
  expect(st.tabs[0].focused).toBe(1)
  expect(st.panes[1]).toEqual({ id: 1, view: 'terminal', cwd: undefined })
})

test('split focuses the new pane and inherits cwd', async () => {
  const s = createStore(fakePty())
  await s.getState().newTab()
  s.getState().setCwd(1, '/work')
  await s.getState().split('row')
  const t = s.getState().tabs[0]
  expect(t.focused).toBe(2)
  expect(t.root.kind).toBe('split')
  expect(s.getState().panes[2].cwd).toBe('/work')
})

test('closing the last pane of the last tab leaves no tab and no active tab (Home shows)', async () => {
  const pty = fakePty()
  const s = createStore(pty)
  await s.getState().newTab()
  await s.getState().closePane()
  const st = s.getState()
  expect(pty.killed).toEqual([1])
  expect(st.tabs).toEqual([])
  expect(st.activeTab).toBe('')
  expect(st.panes[1]).toBeUndefined()
})

test('closing the last tab leaves activeTab empty', async () => {
  const s = createStore(fakePty())
  await s.getState().newTab()
  await s.getState().closeTab(s.getState().activeTab)
  expect(s.getState().tabs).toEqual([])
  expect(s.getState().activeTab).toBe('')
})

test('showHome keeps tabs but clears activeTab; goToTab restores', async () => {
  const s = createStore(fakePty())
  await s.getState().newTab()
  s.getState().showHome()
  expect(s.getState().activeTab).toBe('')
  expect(s.getState().tabs).toHaveLength(1)
  s.getState().goToTab(0)
  expect(s.getState().activeTab).toBe(s.getState().tabs[0].id)
})

test('openCommandTab spawns in cwd, tags the pane with the session and types the command after the prompt delay', async () => {
  vi.useFakeTimers()
  const writes: [number, string][] = []
  const pty = { ...fakePty(), write: async (id: number, data: string) => { writes.push([id, data]) } }
  const s = createStore(pty)
  await s.getState().openCommandTab('/repo', 'claude --resume abc', 'abc')
  const id = s.getState().tabs[0].focused
  expect(s.getState().panes[id].cwd).toBe('/repo')
  expect(s.getState().panes[id].sessionId).toBe('abc')
  expect(writes).toEqual([])
  vi.advanceTimersByTime(700)
  expect(writes).toEqual([[id, 'claude --resume abc\n']])
  vi.useRealTimers()
})

test('closing a pane in a split promotes the sibling and focuses it', async () => {
  const s = createStore(fakePty())
  await s.getState().newTab()
  await s.getState().split('row')
  await s.getState().closePane()
  const t = s.getState().tabs[0]
  expect(t.root).toEqual({ kind: 'leaf', pane: 1 })
  expect(t.focused).toBe(1)
})

test('closing a whole tab activates the previous one', async () => {
  const s = createStore(fakePty())
  await s.getState().newTab()
  await s.getState().newTab()
  await s.getState().closePane()
  const st = s.getState()
  expect(st.tabs).toHaveLength(1)
  expect(st.activeTab).toBe(st.tabs[0].id)
})

test('goToTab and cycle', async () => {
  const s = createStore(fakePty())
  await s.getState().newTab()
  await s.getState().newTab()
  expect(s.getState().activeTab).toBe(s.getState().tabs[1].id)
  s.getState().goToTab(0)
  expect(s.getState().activeTab).toBe(s.getState().tabs[0].id)
  s.getState().cycleTab(-1)
  expect(s.getState().activeTab).toBe(s.getState().tabs[1].id)
  s.getState().goToTab(7)
  expect(s.getState().activeTab).toBe(s.getState().tabs[1].id)
})

test('setCwd and setTitle update the pane record', async () => {
  const s = createStore(fakePty())
  await s.getState().newTab()
  s.getState().setCwd(1, '/tmp')
  s.getState().setTitle(1, 'vim')
  expect(s.getState().panes[1]).toEqual({ id: 1, view: 'terminal', cwd: '/tmp', title: 'vim' })
})

test('paneExited marks the pane', async () => {
  const s = createStore(fakePty())
  await s.getState().newTab()
  s.getState().paneExited(1, 0)
  expect(s.getState().panes[1].exitCode).toBe(0)
})

test('output reaches the attached sink', async () => {
  const pty = fakePty()
  const s = createStore(pty)
  await s.getState().newTab()
  const got: Uint8Array[] = []
  s.getState().attachSink(1, (b) => got.push(b))
  pty.outputs[1](new Uint8Array([104, 105]))
  expect(got).toHaveLength(1)
})

test('spawn failure renders an error pane and never calls kill with a negative id', async () => {
  const pty = fakePty({ failSpawn: true })
  const s = createStore(pty)
  await s.getState().newTab()
  const st = s.getState()
  expect(st.tabs[0].root).toEqual({ kind: 'leaf', pane: -1 })
  expect(st.panes[-1].error).toContain('boom')
  await s.getState().closePane()
  expect(pty.killed).toEqual([])
})

test('output before the pane attaches is buffered, including bytes sent before spawn resolves', async () => {
  const pty = fakePty({ promptBeforeResolve: true })
  const s = createStore(pty)
  await s.getState().newTab()
  pty.outputs[1](new Uint8Array([104, 105]))
  const got: number[] = []
  s.getState().attachSink(1, (b) => got.push(...b))
  expect(got).toEqual([36, 32, 104, 105])
  pty.outputs[1](new Uint8Array([33]))
  expect(got).toEqual([36, 32, 104, 105, 33])
})

test('openView adds a negative-id pane as a split and never touches the PTY', async () => {
  const pty = fakePty()
  const s = createStore(pty)
  await s.getState().newTab()
  s.getState().openView('editor', { path: '/a.ts' }, 'split-row', 'a.ts')
  const t = s.getState().tabs[0]
  expect(t.root.kind).toBe('split')
  expect(t.focused).toBeLessThan(0)
  expect(s.getState().panes[t.focused]).toEqual({ id: t.focused, view: 'editor', props: { path: '/a.ts' }, title: 'a.ts' })
  await s.getState().closePane()
  expect(pty.killed).toEqual([])
  expect(s.getState().tabs[0].root).toEqual({ kind: 'leaf', pane: 1 })
})

test('openView as a tab works on an empty store', () => {
  const s = createStore(fakePty())
  s.getState().openView('mission', {}, 'tab')
  expect(s.getState().tabs).toHaveLength(1)
  expect(s.getState().activeTab).toBe(s.getState().tabs[0].id)
})

test('closeTab kills every pane of the tab and activates a neighbour', async () => {
  const pty = fakePty()
  const s = createStore(pty)
  await s.getState().newTab()
  await s.getState().split('row')
  await s.getState().newTab()
  const first = s.getState().tabs[0].id
  await s.getState().closeTab(first)
  expect(pty.killed.sort()).toEqual([1, 2])
  expect(s.getState().tabs).toHaveLength(1)
  expect(s.getState().activeTab).toBe(s.getState().tabs[0].id)
  expect(s.getState().panes[1]).toBeUndefined()
})

describe('openView auto placement', () => {
  const box = (w: number, h: number) => () => ({ x: 0, y: 0, w, h })

  test('a wide focused pane splits right, a tall one splits down, a small one opens a tab', async () => {
    const s = createStore(fakePty(), { workspace: box(1280, 800) })
    await s.getState().newTab()
    s.getState().openView('editor', { path: '/a' }, 'auto')
    let t = s.getState().tabs[0]
    expect(t.root).toMatchObject({ kind: 'split', dir: 'row' })
    s.getState().openView('browser', { url: 'x' }, 'auto')
    t = s.getState().tabs[0]
    expect(t.root).toMatchObject({ kind: 'split', dir: 'row', children: [{ kind: 'leaf' }, { kind: 'split', dir: 'col' }] })
    s.getState().openView('mission', { id: 'c1' }, 'auto')
    expect(s.getState().tabs).toHaveLength(2)
    expect(s.getState().activeTab).toBe(s.getState().tabs[1].id)
  })

  test('four successive opens in a 1280x800 window make at most two columns', async () => {
    const s = createStore(fakePty(), { workspace: box(1280, 800) })
    await s.getState().newTab()
    for (const v of ['editor', 'browser', 'mission', 'other']) s.getState().openView(v, {}, 'auto')
    const columns = (n: import('./tree').Node): number =>
      n.kind === 'leaf' ? 1 : n.dir === 'row' ? columns(n.children[0]) + columns(n.children[1]) : Math.max(columns(n.children[0]), columns(n.children[1]))
    for (const t of s.getState().tabs) expect(columns(t.root)).toBeLessThanOrEqual(2)
  })

  test('unknown workspace size or no tab opens a tab', async () => {
    const s = createStore(fakePty(), { workspace: () => null })
    s.getState().openView('editor', {}, 'auto')
    expect(s.getState().tabs).toHaveLength(1)
    s.getState().openView('browser', {}, 'auto')
    expect(s.getState().tabs).toHaveLength(2)
  })

  test('mission: a same-view pane in the active tab takes the new props and focus', async () => {
    const s = createStore(fakePty(), { workspace: box(1280, 800) })
    await s.getState().newTab()
    s.getState().openView('mission', { id: 'a' }, 'auto', 'a')
    const mission = s.getState().tabs[0].focused
    s.getState().focusPane(1)
    s.getState().openView('mission', { id: 'b' }, 'auto', 'b')
    const t = s.getState().tabs[0]
    expect(t.focused).toBe(mission)
    expect(s.getState().panes[mission]).toMatchObject({ view: 'mission', props: { id: 'b' }, title: 'b' })
    expect(Object.keys(s.getState().panes)).toHaveLength(2)
  })

  test('browser: a registered handler navigates the open pane instead of replacing props', async () => {
    const got: [number, Record<string, unknown>][] = []
    const off = registerReuse('browser', (id, props) => (got.push([id, props]), true))
    try {
      const s = createStore(fakePty(), { workspace: box(1280, 800) })
      await s.getState().newTab()
      s.getState().openView('browser', { url: 'one' }, 'auto')
      const pane = s.getState().tabs[0].focused
      s.getState().focusPane(1)
      s.getState().openView('browser', { url: 'two' }, 'auto')
      expect(got).toEqual([[pane, { url: 'two' }]])
      expect(s.getState().tabs[0].focused).toBe(pane)
      expect(s.getState().panes[pane].props).toEqual({ url: 'one' })
    } finally {
      off()
    }
  })

  test('editor: a declined reuse (unsaved edits) places a fresh pane by size', async () => {
    let dirty = false
    const off = registerReuse('editor', () => !dirty)
    try {
      const s = createStore(fakePty(), { workspace: box(1280, 800) })
      await s.getState().newTab()
      s.getState().openView('editor', { path: '/a' }, 'auto')
      const first = s.getState().tabs[0].focused
      s.getState().openView('editor', { path: '/b' }, 'auto')
      expect(s.getState().tabs[0].focused).toBe(first)
      dirty = true
      s.getState().openView('editor', { path: '/c' }, 'auto')
      const t = s.getState().tabs[0]
      expect(t.focused).not.toBe(first)
      expect(s.getState().panes[t.focused].props).toEqual({ path: '/c' })
      // the 640px-wide editor was focused, so the fresh pane splits it downward
      expect(t.root).toMatchObject({ kind: 'split', dir: 'row', children: [{ kind: 'leaf' }, { kind: 'split', dir: 'col' }] })
    } finally {
      off()
    }
  })

  test('reuse only looks at the active tab', async () => {
    const s = createStore(fakePty(), { workspace: box(1280, 800) })
    await s.getState().newTab()
    s.getState().openView('mission', { id: 'a' }, 'tab')
    await s.getState().newTab()
    s.getState().openView('mission', { id: 'b' }, 'auto')
    const missions = Object.values(s.getState().panes).filter((p) => p.view === 'mission')
    expect(missions).toHaveLength(2)
  })

  test('explicit places ignore reuse', async () => {
    const s = createStore(fakePty(), { workspace: box(1280, 800) })
    await s.getState().newTab()
    s.getState().openView('mission', { id: 'a' }, 'split-row')
    s.getState().openView('mission', { id: 'b' }, 'split-col')
    expect(Object.values(s.getState().panes).filter((p) => p.view === 'mission')).toHaveLength(2)
  })
})

test('closeOthers keeps the focused leaf and kills the rest', async () => {
  const pty = fakePty()
  const s = createStore(pty)
  await s.getState().newTab()
  await s.getState().split('row')
  s.getState().openView('editor', {}, 'split-col')
  s.getState().focusPane(2)
  await s.getState().closeOthers()
  const t = s.getState().tabs[0]
  expect(t.root).toEqual({ kind: 'leaf', pane: 2 })
  expect(t.focused).toBe(2)
  expect(pty.killed).toEqual([1])
  expect(Object.keys(s.getState().panes).map(Number)).toEqual([2])
})

test('swapPanes exchanges two panes of a tab, keeps focus on its pane and leaves other tabs alone', async () => {
  const s = createStore(fakePty())
  await s.getState().newTab()
  await s.getState().split('row')
  await s.getState().split('col')
  await s.getState().newTab()
  const [first, second] = s.getState().tabs
  s.getState().swapPanes(1, 3)
  const t = s.getState().tabs[0]
  expect(t.root).toEqual({
    kind: 'split', dir: 'row', ratio: 0.5,
    children: [{ kind: 'leaf', pane: 3 }, { kind: 'split', dir: 'col', ratio: 0.5, children: [{ kind: 'leaf', pane: 2 }, { kind: 'leaf', pane: 1 }] }],
  })
  expect(t.focused).toBe(first.focused)
  expect(s.getState().tabs[1]).toBe(second)
  s.getState().swapPanes(1, 4) // different tabs
  expect(s.getState().tabs[0].root).toBe(t.root)
  expect(s.getState().tabs[1]).toBe(second)
})

test('setSessionId tags an existing pane and ignores unknown ids', async () => {
  const s = createStore(fakePty())
  await s.getState().newTab()
  s.getState().setSessionId(1, 'abc')
  expect(s.getState().panes[1].sessionId).toBe('abc')
  s.getState().setSessionId(1, undefined)
  expect(s.getState().panes[1].sessionId).toBeUndefined()
  s.getState().setSessionId(99, 'zzz')
  expect(s.getState().panes[99]).toBeUndefined()
})
