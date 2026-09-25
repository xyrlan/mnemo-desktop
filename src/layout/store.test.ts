import { vi } from 'vitest'
import { createStore, ELSEWHERE, PROMPT_DELAY_MS } from './store'
import { registerReuse } from './reuse'
import { leaves } from './tree'
import { startWorkspace } from './persist'
import type { PtyClient } from '../pty/client'
import { provideSessions, type PtyInfo, type SessionClient } from '../terminal/sessions'

function fakePty(opts: { failSpawn?: boolean; promptBeforeResolve?: boolean; first?: number } = {}): PtyClient & {
  killed: number[]
  outputs: Record<number, (b: Uint8Array) => void>
  spawned: (string | undefined)[]
  writes: [number, string][]
  exits: Record<number, (code: number | null) => void>
} {
  let next = opts.first ?? 1
  const killed: number[] = []
  const outputs: Record<number, (b: Uint8Array) => void> = {}
  const spawned: (string | undefined)[] = []
  const writes: [number, string][] = []
  const exits: Record<number, (code: number | null) => void> = {}
  return {
    killed,
    outputs,
    spawned,
    writes,
    exits,
    spawn: async ({ cwd, onOutput }) => {
      if (opts.failSpawn) throw new Error('boom')
      const id = next++
      spawned.push(cwd)
      outputs[id] = onOutput
      if (opts.promptBeforeResolve) onOutput(new Uint8Array([36, 32])) // "$ " before invoke resolves
      return id
    },
    write: async (id, data) => void writes.push([id, data]),
    resize: async () => {},
    kill: async (id) => {
      killed.push(id)
    },
    onExit: async (id, cb) => {
      exits[id] = cb
      return () => delete exits[id]
    },
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

test('movePane puts a pane on the chosen side of another and collapses the split it left', async () => {
  const s = createStore(fakePty())
  await s.getState().newTab()
  await s.getState().split('row')
  await s.getState().split('col')
  // 1 | (2 / 3)
  s.getState().movePane(1, 3, 'right')
  expect(s.getState().tabs[0].root).toEqual({
    kind: 'split', dir: 'col', ratio: 0.5,
    children: [{ kind: 'leaf', pane: 2 }, { kind: 'split', dir: 'row', ratio: 0.5, children: [{ kind: 'leaf', pane: 3 }, { kind: 'leaf', pane: 1 }] }],
  })
  // 2 / 1 once 3 leaves, then 3 above 2.
  s.getState().movePane(3, 2, 'up')
  expect(s.getState().tabs[0].root).toEqual({
    kind: 'split', dir: 'col', ratio: 0.5,
    children: [{ kind: 'split', dir: 'col', ratio: 0.5, children: [{ kind: 'leaf', pane: 3 }, { kind: 'leaf', pane: 2 }] }, { kind: 'leaf', pane: 1 }],
  })
})

test('movePane onto itself leaves the tree alone instead of deleting the pane', async () => {
  const s = createStore(fakePty())
  await s.getState().newTab()
  await s.getState().split('row')
  const before = s.getState().tabs
  for (const side of ['left', 'right', 'up', 'down'] as const) {
    s.getState().movePane(2, 2, side)
    s.getState().movePane(1, 1, side)
  }
  expect(s.getState().tabs).toBe(before)
  expect(leaves(s.getState().tabs[0].root)).toEqual([1, 2])
})

test('movePane between tabs or to an unknown pane changes nothing', async () => {
  const s = createStore(fakePty())
  await s.getState().newTab()
  await s.getState().split('row')
  await s.getState().newTab()
  const [first, second] = s.getState().tabs
  s.getState().movePane(1, 3, 'left')
  s.getState().movePane(3, 1, 'left')
  s.getState().movePane(1, 99, 'down')
  s.getState().movePane(99, 1, 'down')
  expect(s.getState().tabs[0]).toBe(first)
  expect(s.getState().tabs[1]).toBe(second)
})

test('movePane keeps focus on the pane that held it, moved or not, and leaves other tabs identical', async () => {
  const s = createStore(fakePty())
  await s.getState().newTab()
  await s.getState().split('row')
  await s.getState().split('col')
  await s.getState().newTab()
  s.getState().goToTab(0)
  const second = s.getState().tabs[1]
  s.getState().focusPane(3)
  s.getState().movePane(3, 1, 'left')
  expect(s.getState().tabs[0].focused).toBe(3)
  expect(leaves(s.getState().tabs[0].root)).toEqual([3, 1, 2])
  s.getState().movePane(2, 3, 'up')
  expect(s.getState().tabs[0].focused).toBe(3)
  expect(leaves(s.getState().tabs[0].root)).toEqual([2, 3, 1])
  expect(s.getState().tabs[1]).toBe(second)
  expect(s.getState().activeTab).toBe(s.getState().tabs[0].id)
})

/** Two tabs: 1 | (2 / 3) in the first, 4 alone in the second. */
async function twoTabs() {
  const s = createStore(fakePty())
  await s.getState().newTab('/a')
  await s.getState().split('row', '/b')
  await s.getState().split('col', '/c')
  await s.getState().newTab('/d')
  return s
}

const grouped = (s: ReturnType<typeof createStore>) => s.getState().tabs.map((t) => leaves(t.root))

test('a cross-tab move keeps every pane, out of a split and out of a tab of one alike', async () => {
  const s = await twoTabs()
  const before = grouped(s).flat().sort()
  const second = s.getState().tabs[1].id
  // 3 leaves the split it shares with 2 and joins the tab 4 is alone in.
  s.getState().movePane(3, 4, 'down', second)
  expect(grouped(s)).toEqual([[1, 2], [4, 3]])
  expect(grouped(s).flat().sort()).toEqual(before)
  // …and back out again, into the first tab.
  s.getState().movePane(3, 1, 'left', s.getState().tabs[0].id)
  expect(grouped(s)).toEqual([[3, 1, 2], [4]])
  expect(grouped(s).flat().sort()).toEqual(before)
  expect(Object.keys(s.getState().panes).map(Number).sort()).toEqual(before)
})

test('a tab whose last pane moves away closes, and activeTab follows the pane rather than the hole', async () => {
  const pty = fakePty()
  const s = createStore(pty)
  await s.getState().newTab('/a')
  await s.getState().split('row', '/b')
  await s.getState().newTab('/d')
  const [first, second] = s.getState().tabs
  expect(s.getState().activeTab).toBe(second.id)
  s.getState().movePane(3, 1, 'right', first.id)
  expect(s.getState().tabs.map((t) => t.id)).toEqual([first.id])
  expect(grouped(s)).toEqual([[1, 3, 2]])
  expect(s.getState().activeTab).toBe(first.id)
  // The pane went with it: nothing was killed and nothing was forgotten.
  expect(pty.killed).toEqual([])
  expect(Object.keys(s.getState().panes).map(Number).sort()).toEqual([1, 2, 3])
})

test('focus follows the moved pane, and the tab it left focuses one that still exists', async () => {
  const s = await twoTabs()
  const [first, second] = s.getState().tabs
  s.getState().goToTab(0)
  s.getState().focusPane(3)
  s.getState().movePane(3, 4, 'up', second.id)
  const tabs = s.getState().tabs
  expect(tabs[1].focused).toBe(3)
  expect(leaves(tabs[0].root)).toContain(tabs[0].focused)
  expect(tabs[0].focused).not.toBe(3)
  // The group being looked at survived, so the eye stays where it was.
  expect(s.getState().activeTab).toBe(first.id)
})

test('a cross-tab move is refused when the target is not in the named tab, and asked for no tab at all', async () => {
  const s = await twoTabs()
  const before = s.getState().tabs
  // 1 is not in the second tab.
  s.getState().movePane(4, 1, 'left', before[1].id)
  s.getState().movePane(4, 1, 'left', 'no-such-tab')
  s.getState().movePane(99, 1, 'left', before[0].id)
  // Without a tab named, two tabs are still refused: on screen that pair cannot happen.
  s.getState().movePane(4, 1, 'left')
  expect(s.getState().tabs).toBe(before)
})

test('a cross-tab move round-trips through save and restore, same panes in the same groups', async () => {
  const s = await twoTabs()
  s.getState().movePane(3, 4, 'down', s.getState().tabs[1].id)
  const saved = JSON.parse(JSON.stringify(s.getState().snapshotForSave()))
  const cwds = (st: ReturnType<typeof createStore>) => st.getState().tabs.map((t) => leaves(t.root).map((id) => st.getState().panes[id].cwd))
  expect(cwds(s)).toEqual([['/a', '/b'], ['/d', '/c']])
  const again = createStore(fakePty())
  await again.getState().restore(saved)
  expect(cwds(again)).toEqual([['/a', '/b'], ['/d', '/c']])
  expect(again.getState().tabs).toHaveLength(2)
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

test('setFace flips a terminal pane between faces and leaves other views alone', async () => {
  const s = createStore(fakePty())
  await s.getState().newTab()
  expect(s.getState().panes[1].face).toBeUndefined()
  s.getState().setFace(1, 'conversation')
  expect(s.getState().panes[1].face).toBe('conversation')
  s.getState().setFace(1, 'terminal')
  expect(s.getState().panes[1].face).toBe('terminal')
  s.getState().openView('vault', {}, 'tab')
  const vault = Object.values(s.getState().panes).find((p) => p.view === 'vault')!
  s.getState().setFace(vault.id, 'conversation')
  expect(s.getState().panes[vault.id].face).toBeUndefined()
  s.getState().setFace(99, 'conversation')
  expect(s.getState().panes[99]).toBeUndefined()
})

test('a conversation face survives save and restore; the terminal face is the default and not saved', async () => {
  const s = createStore(fakePty())
  await s.getState().newTab('/a')
  await s.getState().split('row', '/b')
  s.getState().setFace(1, 'conversation')
  s.getState().setFace(2, 'terminal')
  const saved = JSON.parse(JSON.stringify(s.getState().snapshotForSave()))
  expect(saved.worktrees[0].panes['1'].face).toBe('conversation')
  expect(saved.worktrees[0].panes['2'].face).toBeUndefined()
  const again = createStore(fakePty())
  await again.getState().restore(saved)
  const faces = Object.values(again.getState().panes).map((p) => [p.cwd, p.face])
  expect(faces).toEqual([
    ['/a', 'conversation'],
    ['/b', undefined],
  ])
})

test('goToPane shows the tab holding a pane with it focused; renameTab sets and clears a name', async () => {
  const s = createStore(fakePty())
  await s.getState().newTab()
  await s.getState().split('row')
  await s.getState().newTab()
  s.getState().goToPane(1)
  expect(s.getState().activeTab).toBe('tab-1')
  expect(s.getState().tabs[0].focused).toBe(1)
  s.getState().goToPane(99)
  expect(s.getState().activeTab).toBe('tab-1')

  s.getState().renameTab('tab-3', '  build ')
  expect(s.getState().tabs[1].name).toBe('build')
  s.getState().renameTab('tab-3', '')
  expect(s.getState().tabs[1]).not.toHaveProperty('name')
  s.getState().renameTab('tab-3', 'x')
  s.getState().renameTab('tab-3', undefined)
  expect(s.getState().tabs[1]).not.toHaveProperty('name')
})

describe('worktrees', () => {
  test('a switch parks the shown workbench with its panes running and brings it back as it was', async () => {
    const pty = fakePty()
    const s = createStore(pty)
    await s.getState().switchWorktree('/repo')
    await s.getState().newTab()
    await s.getState().split('row')
    s.getState().setRatio([], 0.3)
    const there = s.getState().tabs

    await s.getState().switchWorktree('/repo-wt-a')
    expect(s.getState().activeWorktree).toBe('/repo-wt-a')
    expect(s.getState().tabs).toEqual([])
    expect(s.getState().activeTab).toBe('')
    await s.getState().newTab()
    // A new terminal opens in the worktree shown.
    expect(s.getState().panes[3].cwd).toBe('/repo-wt-a')
    // The parked worktree's panes keep running: none killed, all still panes of the store.
    expect(pty.killed).toEqual([])
    expect(Object.keys(s.getState().panes)).toEqual(['1', '2', '3'])

    await s.getState().switchWorktree('/repo')
    expect(s.getState().tabs).toBe(there)
    expect(s.getState().activeTab).toBe('tab-1')
    expect(s.getState().tabs[0].root).toMatchObject({ kind: 'split', ratio: 0.3 })
    expect(s.getState().openWorktrees()).toEqual(['/repo', '/repo-wt-a'])
  })

  test('worktreeTabs reads any open worktree, and both reads keep their array until it changes', async () => {
    const s = createStore(fakePty())
    await s.getState().switchWorktree('/a')
    await s.getState().newTab()
    await s.getState().switchWorktree('/b')
    const open = s.getState().openWorktrees()
    const a = s.getState().worktreeTabs('/a')
    expect(a.map((t) => t.id)).toEqual(['tab-1'])
    expect(s.getState().worktreeTabs('/b')).toBe(s.getState().tabs)
    expect(s.getState().worktreeTabs('/nowhere')).toEqual([])
    expect(s.getState().worktreeTabs('/nowhere')).toBe(s.getState().worktreeTabs('/elsewhere'))

    await s.getState().newTab()
    expect(s.getState().worktreeTabs('/a')).toBe(a)
    expect(s.getState().openWorktrees()).toBe(open)
    await s.getState().switchWorktree('/b')
    expect(s.getState().openWorktrees()).toBe(open)
  })

  test('tabs opened before any worktree join the first one switched to, after its own', async () => {
    const s = createStore(fakePty())
    await s.getState().newTab('/home')
    expect(s.getState().activeWorktree).toBeNull()
    expect(s.getState().openWorktrees()).toEqual([])
    await s.getState().switchWorktree('/a')
    await s.getState().newTab()
    await s.getState().switchWorktree('/b')
    await s.getState().newTab('/home')
    await s.getState().switchWorktree('/a')
    expect(s.getState().tabs.map((t) => t.id)).toEqual(['tab-1', 'tab-2'])
    expect(s.getState().worktreeTabs('/b').map((t) => t.id)).toEqual(['tab-3'])
  })

  test('closeWorktree kills its panes alone and shows the worktree opened before it', async () => {
    const pty = fakePty()
    const s = createStore(pty)
    for (const w of ['/a', '/b', '/c']) {
      await s.getState().switchWorktree(w)
      await s.getState().newTab()
    }
    s.getState().openView('vault', {}, 'tab')
    await s.getState().switchWorktree('/b')
    await s.getState().split('col')
    const sink = vi.fn()
    s.getState().attachSink(4, sink)

    await s.getState().closeWorktree('/b')
    expect(pty.killed).toEqual([2, 4])
    expect(s.getState().activeWorktree).toBe('/a')
    expect(s.getState().tabs.map((t) => t.id)).toEqual(['tab-1'])
    expect(s.getState().openWorktrees()).toEqual(['/a', '/c'])
    expect(s.getState().panes[2]).toBeUndefined()
    expect(s.getState().sinks[4]).toBeUndefined()
    // A killed shell still reports its exit: the pane stays gone.
    s.getState().paneExited(2, 0)
    s.getState().setTitle(4, 'zsh')
    expect(Object.keys(s.getState().panes).map(Number).sort()).toEqual([-1, 1, 3])

    // A parked worktree closes without touching the one shown; synthetic panes are not killed.
    await s.getState().closeWorktree('/c')
    expect(pty.killed).toEqual([2, 4, 3])
    expect(s.getState().activeWorktree).toBe('/a')
    expect(s.getState().panes[-1]).toBeUndefined()

    await s.getState().closeWorktree('/nowhere')
    await s.getState().closeWorktree('/a')
    expect(s.getState().activeWorktree).toBeNull()
    expect(s.getState().tabs).toEqual([])
    expect(s.getState().activeTab).toBe('')
    expect(s.getState().openWorktrees()).toEqual([])
    expect(s.getState().panes).toEqual({})
  })

  test('closing the first worktree while shown shows the one after it', async () => {
    const s = createStore(fakePty())
    await s.getState().switchWorktree('/a')
    await s.getState().switchWorktree('/b')
    await s.getState().switchWorktree('/a')
    await s.getState().closeWorktree('/a')
    expect(s.getState().activeWorktree).toBe('/b')
  })

  test('goToPane switches to the worktree holding the pane; closeTab closes a tab of a parked one', async () => {
    const pty = fakePty()
    const s = createStore(pty)
    await s.getState().switchWorktree('/a')
    await s.getState().newTab()
    await s.getState().split('row')
    await s.getState().newTab()
    await s.getState().switchWorktree('/b')
    s.getState().goToPane(1)
    expect(s.getState().activeWorktree).toBe('/a')
    expect(s.getState().activeTab).toBe('tab-1')
    expect(s.getState().tabs[0].focused).toBe(1)

    await s.getState().switchWorktree('/b')
    await s.getState().closeTab('tab-3')
    expect(pty.killed).toEqual([3])
    expect(s.getState().worktreeTabs('/a').map((t) => t.id)).toEqual(['tab-1'])
    expect(s.getState().activeWorktree).toBe('/b')
    s.getState().goToPane(99)
    expect(s.getState().activeWorktree).toBe('/b')
  })

  test('a tab whose shell was spawning during a switch lands in the worktree it was opened in', async () => {
    let release: () => void = () => {}
    const base = fakePty()
    const pty: PtyClient = {
      ...base,
      spawn: (o) => new Promise((ok) => (release = () => ok(base.spawn(o)))),
    }
    const s = createStore(pty)
    await s.getState().switchWorktree('/a')
    const opening = s.getState().newTab()
    await s.getState().switchWorktree('/b')
    release()
    await opening
    expect(s.getState().tabs).toEqual([])
    expect(s.getState().worktreeTabs('/a').map((t) => t.id)).toEqual(['tab-1'])

    // A split finishing after a switch splits its own tab, parked or not.
    await s.getState().switchWorktree('/a')
    const splitting = s.getState().split('row')
    await s.getState().switchWorktree('/b')
    release()
    await splitting
    expect(leaves(s.getState().worktreeTabs('/a')[0].root)).toEqual([1, 2])
    expect(s.getState().tabs).toEqual([])
  })

  test('a split in a pane without a cwd starts in the shown worktree', async () => {
    const s = createStore(fakePty(), { workspace: () => null })
    await s.getState().switchWorktree('/a')
    s.getState().openView('vault', {}, 'tab')
    await s.getState().split('row')
    expect(s.getState().panes[1].cwd).toBe('/a')
    await s.getState().openCommandTab(undefined, 'claude')
    expect(s.getState().panes[2].cwd).toBe('/a')
  })
})

describe('terminals that outlived the page', () => {
  const text = (chunks: Uint8Array[]) => chunks.map((c) => new TextDecoder().decode(c)).join('')
  const live = (id: number, cwd: string, alive = true): PtyInfo => ({ id, cwd, pid: 1000 + id, alive })

  /** The core's terminals: `held` listed, each attach answered with `screens[id]`, `early` sent
   *  through the channel before the answer. A terminal not alive refuses. */
  function fakeSessions(held: PtyInfo[], screens: Record<number, string> = {}, early: Record<number, string> = {}) {
    const attached: number[] = []
    const outputs: Record<number, (b: Uint8Array) => void> = {}
    const client: SessionClient = {
      list: async () => held,
      attach: async (id, onOutput) => {
        if (!held.find((i) => i.id === id)?.alive) throw new Error(`pane ${id} has exited`)
        attached.push(id)
        outputs[id] = onOutput
        if (early[id]) onOutput(new TextEncoder().encode(early[id]))
        return new TextEncoder().encode(screens[id] ?? '')
      },
    }
    return { client, attached, outputs }
  }

  /** A workspace of one tab: a shell in /a beside one in /b running Claude session `sess`. */
  async function savedPair() {
    const s = createStore(fakePty(), { workspace: () => null })
    await s.getState().newTab('/a')
    await s.getState().split('row', '/b')
    s.getState().setSessionId(2, 'sess')
    return JSON.parse(JSON.stringify(s.getState().snapshotForSave()))
  }

  test('a saved pane whose shell kept running attaches to it under its id, screen first, and nothing is spawned or typed', async () => {
    vi.useFakeTimers()
    try {
      const pty = fakePty({ first: 100 })
      const core = fakeSessions([live(1, '/a/moved'), live(2, '/b')], { 1: 'screen of 1' })
      const s = createStore(pty, { workspace: () => null, sessions: core.client })
      await s.getState().restore(await savedPair())
      vi.advanceTimersByTime(PROMPT_DELAY_MS * 2)

      expect(core.attached).toEqual([1, 2])
      expect(pty.spawned).toEqual([])
      // The Claude session in it runs on: no `claude --resume` typed into it.
      expect(pty.writes).toEqual([])
      expect(leaves(s.getState().tabs[0].root)).toEqual([1, 2])
      expect(s.getState().tabs[0].id).toBe('tab-1')
      expect(s.getState().panes[1]).toEqual({ id: 1, view: 'terminal', cwd: '/a/moved' })
      expect(s.getState().panes[2].sessionId).toBe('sess')

      const got: Uint8Array[] = []
      s.getState().attachSink(1, (b) => got.push(b))
      core.outputs[1](new TextEncoder().encode(' then live'))
      expect(text(got)).toBe('screen of 1 then live')
      // Its exit is heard.
      pty.exits[1](0)
      expect(s.getState().panes[1].exitCode).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  test('output that beats the attach answer goes after the screen', async () => {
    const core = fakeSessions([live(1, '/a'), live(2, '/b')], { 1: 'screen,' }, { 1: 'early' })
    const s = createStore(fakePty({ first: 100 }), { workspace: () => null, sessions: core.client })
    await s.getState().restore(await savedPair())
    const got: Uint8Array[] = []
    s.getState().attachSink(1, (b) => got.push(b))
    expect(text(got)).toBe('screen,early')
  })

  test('a shell that ended while away is forgotten, and the pane gets a new one with its Claude session resumed', async () => {
    vi.useFakeTimers()
    try {
      const pty = fakePty({ first: 100 })
      const core = fakeSessions([live(1, '/a'), live(2, '/b', false)])
      const s = createStore(pty, { workspace: () => null, sessions: core.client })
      await s.getState().restore(await savedPair())
      vi.advanceTimersByTime(PROMPT_DELAY_MS)
      expect(core.attached).toEqual([1])
      expect(pty.spawned).toEqual(['/b'])
      expect(leaves(s.getState().tabs[0].root)).toEqual([1, 100])
      expect(pty.writes).toEqual([[100, 'claude --resume sess\n']])
      expect(pty.killed).toEqual([2])
      expect(s.getState().panes[2]).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  test('a shell that cannot be attached leaves no pane behind and the pane gets a new one', async () => {
    const pty = fakePty({ first: 100 })
    const core = fakeSessions([live(1, '/a'), live(2, '/b')])
    const s = createStore(pty, { workspace: () => null, sessions: core.client })
    core.client.attach = async () => {
      throw new Error('gone meanwhile')
    }
    await s.getState().restore(await savedPair())
    expect(leaves(s.getState().tabs[0].root)).toEqual([100, 101])
    expect(Object.keys(s.getState().panes).map(Number).sort()).toEqual([100, 101])
    expect(pty.exits[1]).toBeUndefined()
  })

  test('shells no saved pane claims come back as tabs where their folder is, else elsewhere, and what is shown stays shown', async () => {
    const src = createStore(fakePty(), { workspace: () => null })
    await src.getState().switchWorktree('/r')
    await src.getState().newTab()
    await src.getState().switchWorktree('/r-wt')
    await src.getState().newTab()
    await src.getState().switchWorktree('/r/.claude/worktrees/x')
    await src.getState().newTab()
    await src.getState().switchWorktree('/r')
    const saved = JSON.parse(JSON.stringify(src.getState().snapshotForSave()))

    const pty = fakePty({ first: 100 })
    const orphans = [live(50, '/r-wt/src'), live(51, '/elsewhere'), live(52, '/r', false), live(53, '/r-wtx'), live(54, '/r/.claude/worktrees/x/src')]
    const core = fakeSessions([live(1, '/r'), live(2, '/r-wt'), live(3, '/r/.claude/worktrees/x'), ...orphans])
    const s = createStore(pty, { workspace: () => null, sessions: core.client })
    await s.getState().restore(saved)

    expect(s.getState().activeWorktree).toBe('/r')
    expect(s.getState().activeTab).toBe('tab-1')
    // Deepest open worktree holding the folder; a sibling whose name only starts the same is not it.
    expect(s.getState().worktreeTabs('/r-wt').map((t) => t.id)).toEqual(['tab-2', 'tab-50'])
    expect(s.getState().parked['/r-wt'].activeTab).toBe('tab-2')
    expect(s.getState().worktreeTabs('/r/.claude/worktrees/x').map((t) => t.id)).toEqual(['tab-3', 'tab-54'])
    // A folder no open worktree holds is no worktree's: not the shown one's either.
    expect(s.getState().tabs.map((t) => t.id)).toEqual(['tab-1'])
    expect(s.getState().worktreeTabs(ELSEWHERE).map((t) => t.id)).toEqual(['tab-51', 'tab-53'])
    expect(s.getState().openWorktrees()).toEqual(['/r', '/r-wt', '/r/.claude/worktrees/x'])
    expect(s.getState().panes[50]).toEqual({ id: 50, view: 'terminal', cwd: '/r-wt/src' })
    expect(pty.killed).toEqual([52])
    expect(pty.spawned).toEqual([])
  })

  test('a workspace file that cannot be read still brings the shells back, and still says so', async () => {
    const core = fakeSessions([live(7, '/x')])
    const s = createStore(fakePty({ first: 100 }), { workspace: () => null, sessions: core.client })
    await expect(s.getState().restore('not a workspace')).rejects.toThrow()
    expect(s.getState().worktreeTabs(ELSEWHERE).map((t) => t.id)).toEqual(['tab-7'])
    expect(s.getState().tabs).toEqual([])
    expect(s.getState().activeTab).toBe('')

    // No file at all: the same.
    const t = createStore(fakePty({ first: 100 }), { workspace: () => null, sessions: fakeSessions([live(8, '/y')]).client })
    await t.getState().restore({})
    expect(t.getState().worktreeTabs(ELSEWHERE).map((tab) => tab.id)).toEqual(['tab-8'])
  })

  /** A store restored with `/r` shown and no tab of its own, and shells in `/r/src`, `/w/a` and `~/scratch` no worktree held. */
  async function strays() {
    const pty = fakePty({ first: 100 })
    const saved = { version: 2, activeWorktree: '/r', worktrees: [{ path: '/r', activeTab: '', tabs: [], panes: {} }] }
    const s = createStore(pty, { workspace: () => null, sessions: fakeSessions([live(5, '/r/src'), live(6, '/w/a'), live(7, '/home/me/scratch')]).client })
    await s.getState().restore(saved)
    return { s, pty }
  }

  test('a worktree that opens later takes the shells in its folder, without showing them', async () => {
    const { s } = await strays()
    expect(s.getState().tabs.map((t) => t.id)).toEqual(['tab-5'])
    expect(s.getState().activeTab).toBe('')
    await s.getState().switchWorktree('/w')
    expect(s.getState().tabs.map((t) => t.id)).toEqual(['tab-6'])
    expect(s.getState().activeTab).toBe('')
    expect(s.getState().worktreeTabs(ELSEWHERE).map((t) => t.id)).toEqual(['tab-7'])
    // Never a worktree: nothing opens or shows it.
    await s.getState().switchWorktree(ELSEWHERE)
    expect(s.getState().activeWorktree).toBe('/w')
    expect(s.getState().openWorktrees()).toEqual(['/r', '/w'])
  })

  test('bringTab moves a tab of no worktree into the one shown and shows it; goToPane does the same', async () => {
    const { s } = await strays()
    s.getState().bringTab('tab-7')
    expect(s.getState().tabs.map((t) => t.id)).toEqual(['tab-5', 'tab-7'])
    expect(s.getState().activeTab).toBe('tab-7')
    expect(s.getState().worktreeTabs(ELSEWHERE).map((t) => t.id)).toEqual(['tab-6'])
    s.getState().bringTab('tab-5')
    expect(s.getState().tabs.map((t) => t.id)).toEqual(['tab-5', 'tab-7'])

    await s.getState().switchWorktree('/q')
    s.getState().goToPane(6)
    expect(s.getState().activeWorktree).toBe('/q')
    expect(s.getState().tabs.map((t) => t.id)).toEqual(['tab-6'])
    expect(s.getState().activeTab).toBe('tab-6')
    expect(s.getState().worktreeTabs(ELSEWHERE)).toEqual([])
  })

  test('a tab of no worktree closes like any other', async () => {
    const { s, pty } = await strays()
    await s.getState().closeTab('tab-7')
    expect(pty.killed).toEqual([7])
    expect(s.getState().worktreeTabs(ELSEWHERE).map((t) => t.id)).toEqual(['tab-6'])
    expect(s.getState().panes[7]).toBeUndefined()
  })

  test('the tabs of no worktree are saved as the layout of no worktree, and come back there', async () => {
    const { s } = await strays()
    const saved = JSON.parse(JSON.stringify(s.getState().snapshotForSave()))
    expect(saved.activeWorktree).toBe('/r')
    expect(saved.worktrees.map((w: { path: string | null; tabs: unknown[] }) => [w.path, w.tabs.length])).toEqual([
      ['/r', 1],
      [null, 2],
    ])
    const again = createStore(fakePty({ first: 100 }), { workspace: () => null, sessions: fakeSessions([live(5, '/r/src'), live(6, '/w/a'), live(7, '/x')]).client })
    await again.getState().restore(saved)
    expect(again.getState().tabs.map((t) => t.id)).toEqual(['tab-5'])
    expect(again.getState().worktreeTabs(ELSEWHERE).map((t) => t.id)).toEqual(['tab-6', 'tab-7'])
    expect(again.getState().openWorktrees()).toEqual(['/r'])
  })

  test('a shell is claimed by one saved pane only', async () => {
    const one = (path: string) => ({ path, activeTab: 'tab-1', tabs: [{ id: 'tab-1', root: { kind: 'leaf', pane: 1 }, focused: 1 }], panes: { '1': { view: 'terminal', cwd: path } } })
    const saved = { version: 2, activeWorktree: '/a', worktrees: [one('/a'), one('/b')] }
    const pty = fakePty({ first: 100 })
    const core = fakeSessions([live(1, '/a')])
    const s = createStore(pty, { workspace: () => null, sessions: core.client })
    await s.getState().restore(saved)
    expect(core.attached).toEqual([1])
    expect(pty.spawned).toEqual(['/b'])
    expect(leaves(s.getState().worktreeTabs('/b')[0].root)).toEqual([100])
  })

  test('a listing that fails leaves every terminal to spawn as before', async () => {
    const pty = fakePty({ first: 100 })
    const core = fakeSessions([])
    const s = createStore(pty, { workspace: () => null, sessions: core.client })
    core.client.list = async () => {
      throw new Error('no daemon')
    }
    await s.getState().restore(await savedPair())
    expect(pty.spawned).toEqual(['/a', '/b'])
  })

  test('a view mounted again gets the restored screen again, until live output reaches one', async () => {
    const core = fakeSessions([live(1, '/a'), live(2, '/b')], { 1: 'screen' })
    const s = createStore(fakePty({ first: 100 }), { workspace: () => null, sessions: core.client })
    await s.getState().restore(await savedPair())
    const first: Uint8Array[] = []
    const second: Uint8Array[] = []
    const third: Uint8Array[] = []
    s.getState().attachSink(1, (b) => first.push(b))
    // StrictMode: mounted, unmounted, mounted again at once.
    s.getState().attachSink(1, (b) => second.push(b))
    expect(text(first)).toBe('screen')
    expect(text(second)).toBe('screen')
    core.outputs[1](new TextEncoder().encode('!'))
    expect(text(second)).toBe('screen!')
    s.getState().attachSink(1, (b) => third.push(b))
    expect(third).toEqual([])
  })

  test('with no client given, the one the terminal view provides is used, through any wrapper of restore', async () => {
    const core = fakeSessions([live(1, '/a'), live(2, '/b')])
    provideSessions(core.client)
    try {
      const s = createStore(fakePty({ first: 100 }), { workspace: () => null })
      // As the setup pane waits on it (`src/setup/launch.ts`): the saved layout, alone.
      const restore = s.getState().restore
      s.setState({ restore: async (saved) => restore(saved) })
      const saved = await savedPair()
      const ws = startWorkspace(s, { read: async () => saved, write: async () => {} }, 5)
      await ws.ready
      ws.stop()
      expect(core.attached).toEqual([1, 2])
    } finally {
      provideSessions(null)
    }
  })
})
