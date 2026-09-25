import { vi } from 'vitest'
import { createStore, ELSEWHERE, PROMPT_DELAY_MS, type Place } from './store'
import { registerReuse } from './reuse'
import { leaves } from './tree'
import { groupIds } from './groups'
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

/** Each group's tabs, in the order the groups are laid out. */
const groupTabs = (s: ReturnType<typeof createStore>) => groupIds(s.getState().groupRoot).map((g) => s.getState().groups[g].tabs)
/** The group of the shown worktree holding tab `id`. */
const groupOf = (s: ReturnType<typeof createStore>, id: string) => Object.values(s.getState().groups).find((g) => g.tabs.includes(id))?.id

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

test('openView to the side opens a negative-id pane as a tab in a group of its own, and never touches the PTY', async () => {
  const pty = fakePty()
  const s = createStore(pty)
  await s.getState().newTab()
  s.getState().openView('editor', { path: '/a.ts' }, 'split-row', 'a.ts')
  const st = s.getState()
  // The terminal keeps its tab whole: the file is a tab beside it, not a pane squeezed into it.
  expect(st.tabs.map((t) => leaves(t.root).length)).toEqual([1, 1])
  const file = st.tabs[1]
  expect(file.focused).toBeLessThan(0)
  expect(st.panes[file.focused]).toEqual({ id: file.focused, view: 'editor', props: { path: '/a.ts' }, title: 'a.ts' })
  expect(st.groupRoot).toMatchObject({ kind: 'split', dir: 'row', ratio: 0.5 })
  expect(groupTabs(s)).toEqual([['tab-1'], [file.id]])
  expect(st.activeTab).toBe(file.id)
  expect(st.activeGroup).toBe(groupOf(s, file.id))
  // Closing it closes its tab, and the group left empty collapses into the terminal's.
  await s.getState().closePane()
  expect(pty.killed).toEqual([])
  expect(s.getState().tabs.map((t) => t.root)).toEqual([{ kind: 'leaf', pane: 1 }])
  expect(s.getState().groupRoot).toEqual({ kind: 'group', group: groupOf(s, 'tab-1') })
  expect(s.getState().activeTab).toBe('tab-1')
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

describe('openView placement', () => {
  const box = (w: number, h: number) => () => ({ x: 0, y: 0, w, h })

  test('auto never splits: however wide the focused pane, a view is a tab of its own in the active group', async () => {
    const s = createStore(fakePty(), { workspace: box(1280, 800) })
    await s.getState().newTab()
    for (const v of ['editor', 'browser', 'mission', 'other']) s.getState().openView(v, {}, 'auto')
    expect(s.getState().tabs.map((t) => t.root.kind)).toEqual(['leaf', 'leaf', 'leaf', 'leaf', 'leaf'])
    expect(groupTabs(s)).toHaveLength(1)
    expect(s.getState().activeTab).toBe(s.getState().tabs[4].id)
  })

  test('on an empty store every place opens the first tab, in the first group', () => {
    for (const place of ['auto', 'tab', 'split-row', 'split-col'] as const) {
      const s = createStore(fakePty(), { workspace: () => null })
      s.getState().openView('mission', {}, place)
      expect(groupTabs(s)).toEqual([[s.getState().tabs[0].id]])
      expect(s.getState().activeTab).toBe(s.getState().tabs[0].id)
    }
  })

  test('split-row and split-col open to the side: into the group there, made when there is none', async () => {
    const s = createStore(fakePty())
    await s.getState().newTab()
    const left = groupOf(s, 'tab-1')!
    s.getState().openView('editor', { path: '/a' }, 'split-row')
    const right = s.getState().activeGroup
    expect(right).not.toBe(left)
    // From the terminal's group again: there is a group to its right now, and it takes the tab.
    s.getState().focusGroup(left)
    s.getState().openView('editor', { path: '/b' }, 'split-row')
    expect(groupTabs(s)).toEqual([['tab-1'], ['tab--1', 'tab--2']])
    expect(s.getState().activeGroup).toBe(right)
    expect(s.getState().activeTab).toBe('tab--2')
    // Below the terminal there is nothing yet: a group is made there, under it alone.
    s.getState().focusGroup(left)
    s.getState().openView('browser', {}, 'split-col')
    const below = s.getState().activeGroup
    expect(s.getState().groupRoot).toEqual({
      kind: 'split',
      dir: 'row',
      ratio: 0.5,
      children: [
        { kind: 'split', dir: 'col', ratio: 0.5, children: [{ kind: 'group', group: left }, { kind: 'group', group: below }] },
        { kind: 'group', group: right },
      ],
    })
    // Nothing was squeezed into the terminal's tab.
    expect(s.getState().tabs.every((t) => leaves(t.root).length === 1)).toBe(true)
  })

  test('mission: a tab of the view anywhere in the worktree takes the new props and shows', async () => {
    const s = createStore(fakePty())
    await s.getState().newTab()
    s.getState().openView('mission', { id: 'a' }, 'split-row', 'a')
    const mission = s.getState().tabs[1]
    s.getState().focusPane(1)
    expect(s.getState().activeTab).toBe('tab-1')
    s.getState().openView('mission', { id: 'b' }, 'auto', 'b')
    expect(s.getState().activeTab).toBe(mission.id)
    expect(s.getState().activeGroup).toBe(groupOf(s, mission.id))
    expect(s.getState().panes[mission.focused]).toMatchObject({ view: 'mission', props: { id: 'b' }, title: 'b' })
    expect(Object.keys(s.getState().panes)).toHaveLength(2)
  })

  test('browser: a registered handler navigates the open pane instead of replacing props', async () => {
    const got: [number, Record<string, unknown>][] = []
    const off = registerReuse('browser', (id, props) => (got.push([id, props]), true))
    try {
      const s = createStore(fakePty())
      await s.getState().newTab()
      s.getState().openView('browser', { url: 'one' }, 'auto')
      const tab = s.getState().tabs[1]
      s.getState().focusPane(1)
      s.getState().openView('browser', { url: 'two' }, 'auto')
      expect(got).toEqual([[tab.focused, { url: 'two' }]])
      expect(s.getState().activeTab).toBe(tab.id)
      expect(s.getState().panes[tab.focused].props).toEqual({ url: 'one' })
    } finally {
      off()
    }
  })

  test('editor: a declined reuse (unsaved edits) opens a new tab, never a split', async () => {
    let dirty = false
    const off = registerReuse('editor', () => !dirty)
    try {
      const s = createStore(fakePty(), { workspace: box(1280, 800) })
      await s.getState().newTab()
      s.getState().openView('editor', { path: '/a' }, 'auto')
      const first = s.getState().tabs[1]
      s.getState().openView('editor', { path: '/b' }, 'auto')
      expect(s.getState().tabs).toHaveLength(2)
      expect(s.getState().activeTab).toBe(first.id)
      dirty = true
      s.getState().openView('editor', { path: '/c' }, 'auto')
      const st = s.getState()
      expect(st.tabs).toHaveLength(3)
      expect(st.panes[st.tabs[2].focused].props).toEqual({ path: '/c' })
      expect(st.activeTab).toBe(st.tabs[2].id)
      expect(st.tabs.every((t) => t.root.kind === 'leaf')).toBe(true)
    } finally {
      off()
    }
  })

  test('reuse looks through the whole worktree shown, and never into another', async () => {
    const s = createStore(fakePty())
    const missions = () => Object.values(s.getState().panes).filter((p) => p.view === 'mission')
    await s.getState().switchWorktree('/a')
    await s.getState().newTab()
    s.getState().openView('mission', { id: 'a' }, 'tab')
    await s.getState().newTab()
    // Another tab shows, and the mission tab is still the one that takes it.
    s.getState().openView('mission', { id: 'b' }, 'auto')
    expect(missions()).toHaveLength(1)
    expect(s.getState().activeTab).toBe('tab--1')
    await s.getState().switchWorktree('/b')
    s.getState().openView('mission', { id: 'c' }, 'auto')
    expect(missions()).toHaveLength(2)
  })

  test('explicit places ignore reuse', async () => {
    const s = createStore(fakePty(), { workspace: box(1280, 800) })
    await s.getState().newTab()
    s.getState().openView('mission', { id: 'a' }, 'split-row')
    s.getState().openView('mission', { id: 'b' }, 'split-col')
    s.getState().openView('mission', { id: 'c' }, 'tab')
    expect(Object.values(s.getState().panes).filter((p) => p.view === 'mission')).toHaveLength(3)
  })

  describe('a document view (one that registers `shows`)', () => {
    /** A fake file view: each pane shows the path its handler last took, else the one it opened
     *  with; the handler refuses a pane with unsaved edits (`dirty`). */
    function files() {
      const s = createStore(fakePty())
      const at = new Map<number, string>()
      const dirty = new Set<number>()
      const path = (id: number) => at.get(id) ?? s.getState().panes[id]?.props?.path
      const off = registerReuse(
        'doc',
        (id, p) => {
          if (dirty.has(id)) return false
          at.set(id, String(p.path))
          return true
        },
        (id, p) => path(id) === p.path,
      )
      const open = (file: string, place: Place = 'auto', preview = false) => s.getState().openView('doc', { path: file }, place, file, { preview })
      /** What each group holds: a file by its path (`*` a preview), a terminal as `$`. */
      const layout = () =>
        groupTabs(s).map((ids) =>
          ids.map((id) => {
            const t = s.getState().tabs.find((x) => x.id === id)!
            const p = s.getState().panes[t.focused]
            return p.view === 'terminal' ? '$' : `${path(t.focused)}${t.preview ? '*' : ''}`
          }),
        )
      const shown = () => {
        const st = s.getState()
        const t = st.tabs.find((x) => x.id === st.activeTab)!
        return st.panes[t.focused].view === 'terminal' ? '$' : path(t.focused)
      }
      return { s, dirty, off, open, layout, shown }
    }
    let f: ReturnType<typeof files>
    beforeEach(async () => {
      f = files()
      await f.s.getState().newTab()
    })
    afterEach(() => f.off())

    test('it opens in the active group, unless that group shows a terminal; then in a group showing a file', () => {
      // Only a terminal anywhere: the active group it is.
      f.open('/a')
      expect(f.layout()).toEqual([['$', '/a']])
      f.open('/b', 'split-row')
      expect(f.layout()).toEqual([['$', '/a'], ['/b']])
      // Back on the terminal: the file goes where a file shows, not over the terminal.
      f.s.getState().focusPane(1)
      f.open('/c')
      expect(f.layout()).toEqual([['$', '/a'], ['/b', '/c']])
      expect(f.shown()).toBe('/c')
      // The first group showing a file is where it goes, and the active one is when it shows one.
      f.s.getState().activateTab(f.s.getState().tabs[1].id)
      f.open('/d')
      expect(f.layout()).toEqual([['$', '/a', '/d'], ['/b', '/c']])
    })

    test('a file already open shows instead of opening again: in the target group first, then anywhere', () => {
      f.open('/a', 'split-row')
      const right = f.s.getState().activeGroup
      f.s.getState().focusPane(1)
      f.open('/a')
      expect(f.layout()).toEqual([['$'], ['/a']])
      expect(f.s.getState().activeGroup).toBe(right)
      // The terminal's group shows a file of its own now, so it is the target; /a is found elsewhere.
      f.s.getState().focusPane(1)
      f.open('/b', 'tab')
      f.open('/a')
      expect(f.layout()).toEqual([['$', '/b'], ['/a']])
      expect(f.s.getState().activeGroup).toBe(right)
    })

    test('a preview replaces the one its group has, through the view, in its place', () => {
      f.open('/a', 'auto', true)
      expect(f.layout()).toEqual([['$', '/a*']])
      const preview = f.s.getState().tabs[1]
      f.open('/b', 'auto', true)
      // The same tab, navigated: nothing opened, nothing closed.
      expect(f.layout()).toEqual([['$', '/b*']])
      expect(f.s.getState().tabs[1].id).toBe(preview.id)
      expect(f.shown()).toBe('/b')
      // A preview that will not take it (unsaved edits) gives its place to a new one.
      f.dirty.add(preview.focused)
      f.open('/c', 'auto', true)
      expect(f.layout()).toEqual([['$', '/c*']])
      expect(f.s.getState().tabs[1].id).not.toBe(preview.id)
      expect(f.s.getState().panes[preview.focused]).toBeUndefined()
    })

    test('a preview is replaced only in its own group, and a kept tab never is', () => {
      f.open('/a', 'auto', true)
      f.open('/b', 'split-row')
      f.open('/c', 'auto', true)
      expect(f.layout()).toEqual([['$', '/a*'], ['/b', '/c*']])
      f.s.getState().keepTab(f.s.getState().activeTab)
      f.open('/d', 'auto', true)
      expect(f.layout()).toEqual([['$', '/a*'], ['/b', '/c', '/d*']])
      // Explicitly placed, a preview still replaces the preview of the group it lands in.
      f.s.getState().focusPane(1)
      f.open('/e', 'tab', true)
      expect(f.layout()).toEqual([['$', '/e*'], ['/b', '/c', '/d*']])
    })

    test('opened without preview on a preview tab, that tab is kept; asked as a preview, a kept tab stays kept', () => {
      f.open('/a', 'auto', true)
      f.open('/a')
      expect(f.layout()).toEqual([['$', '/a']])
      f.open('/a', 'auto', true)
      expect(f.layout()).toEqual([['$', '/a']])
    })

    test('explicit places never open a file twice in the group they land in', () => {
      f.open('/a', 'tab')
      f.open('/a', 'tab')
      expect(f.layout()).toEqual([['$', '/a']])
      // Another group may hold it too.
      f.open('/a', 'split-row')
      expect(f.layout()).toEqual([['$', '/a'], ['/a']])
      f.s.getState().focusPane(1)
      f.open('/a', 'split-row')
      expect(f.layout()).toEqual([['$', '/a'], ['/a']])
      expect(f.s.getState().activeGroup).toBe(groupIds(f.s.getState().groupRoot)[1])
    })
  })
})

test('closeOthers keeps the focused leaf and kills the rest', async () => {
  const pty = fakePty()
  const s = createStore(pty)
  await s.getState().newTab()
  await s.getState().split('row')
  await s.getState().split('col')
  s.getState().focusPane(2)
  await s.getState().closeOthers()
  const t = s.getState().tabs[0]
  expect(t.root).toEqual({ kind: 'leaf', pane: 2 })
  expect(t.focused).toBe(2)
  expect(pty.killed).toEqual([1, 3])
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
    // It joins the active group.
    expect(Object.values(s.getState().groups).map((g) => g.tabs)).toEqual([['tab-5', 'tab-7']])
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

describe('groups', () => {
  /** A terminal (tab-1) in the left group, and on its right a vault and a mission tab, the mission shown. */
  async function sideBySide() {
    const pty = fakePty()
    const s = createStore(pty)
    await s.getState().newTab('/a')
    s.getState().openView('vault', {}, 'split-row', 'vault')
    s.getState().openView('mission', {}, 'tab', 'mission')
    const [left, right] = groupIds(s.getState().groupRoot)
    return { s, pty, left, right }
  }

  test('a tab closed shows its left neighbour; a group left with no tab collapses, and its sibling becomes active', async () => {
    const { s, left, right } = await sideBySide()
    expect(groupTabs(s)).toEqual([['tab-1'], ['tab--1', 'tab--2']])
    expect([s.getState().activeGroup, s.getState().activeTab]).toEqual([right, 'tab--2'])
    await s.getState().closeTab('tab--2')
    expect([s.getState().activeGroup, s.getState().activeTab]).toEqual([right, 'tab--1'])
    await s.getState().closePane()
    expect(s.getState().groupRoot).toEqual({ kind: 'group', group: left })
    expect(Object.keys(s.getState().groups)).toEqual([left])
    expect([s.getState().activeGroup, s.getState().activeTab]).toEqual([left, 'tab-1'])
  })

  test('closing a tab of a group that is not active leaves the active group as it is', async () => {
    const { s, left, right } = await sideBySide()
    s.getState().focusGroup(left)
    await s.getState().newTab('/b')
    s.getState().focusGroup(right)
    await s.getState().closeTab('tab-2')
    expect(s.getState().groups[left]).toEqual({ id: left, tabs: ['tab-1'], activeTab: 'tab-1' })
    expect([s.getState().activeGroup, s.getState().activeTab]).toEqual([right, 'tab--2'])
    await s.getState().closeTab('tab-1')
    expect(groupTabs(s)).toEqual([['tab--1', 'tab--2']])
    expect([s.getState().activeGroup, s.getState().activeTab]).toEqual([right, 'tab--2'])
    // The worktree's last tab leaves no group, and Home shows.
    await s.getState().closeTab('tab--1')
    await s.getState().closeTab('tab--2')
    const st = s.getState()
    expect([st.tabs, st.groups, st.groupRoot, st.activeGroup, st.activeTab]).toEqual([[], {}, null, '', ''])
  })

  test('⌃N, ⌘⇧[ and ⌘⇧] count the tabs of the active group alone', async () => {
    const { s, left } = await sideBySide()
    s.getState().goToTab(0)
    expect(s.getState().activeTab).toBe('tab--1')
    s.getState().goToTab(2)
    expect(s.getState().activeTab).toBe('tab--1')
    s.getState().cycleTab(-1)
    expect(s.getState().activeTab).toBe('tab--2')
    s.getState().cycleTab(1)
    expect(s.getState().activeTab).toBe('tab--1')
    s.getState().focusGroup(left)
    expect(s.getState().activeTab).toBe('tab-1')
    s.getState().cycleTab(1)
    expect(s.getState().activeTab).toBe('tab-1')
  })

  test('focusing a pane in another group makes that group active, and shows its tab there', async () => {
    const { s, left, right } = await sideBySide()
    s.getState().focusPane(1)
    expect([s.getState().activeGroup, s.getState().activeTab]).toEqual([left, 'tab-1'])
    // A pane of a tab its group does not show: that tab shows.
    s.getState().focusPane(-1)
    expect([s.getState().activeGroup, s.getState().activeTab]).toEqual([right, 'tab--1'])
    expect(s.getState().groups[right].activeTab).toBe('tab--1')
    // Nothing changes for a pane already focused, nor for one no tab holds.
    const before = s.getState()
    s.getState().focusPane(-1)
    s.getState().focusPane(99)
    expect(s.getState()).toBe(before)
  })

  test('⌘D splits a terminal tab; in any other tab it opens a terminal tab to that side', async () => {
    const s = createStore(fakePty())
    await s.getState().newTab('/a')
    await s.getState().split('row')
    expect(leaves(s.getState().tabs[0].root)).toEqual([1, 2])
    s.getState().openView('vault', {}, 'tab')
    const left = s.getState().activeGroup
    await s.getState().split('row', '/x')
    // The vault stays whole; the shell is a tab of the group made on its right.
    expect(groupTabs(s)).toEqual([['tab-1', 'tab--1'], ['tab-3']])
    expect(s.getState().activeTab).toBe('tab-3')
    expect(s.getState().panes[3]).toMatchObject({ view: 'terminal', cwd: '/x' })
    // In that terminal tab, ⌘⇧D splits the terminal itself.
    await s.getState().split('col')
    expect(leaves(s.getState().tabs.find((t) => t.id === 'tab-3')!.root)).toEqual([3, 4])
    // From the vault, ⌘⇧D: below it there is no group yet, so one is made.
    s.getState().focusGroup(left)
    expect(s.getState().activeTab).toBe('tab--1')
    await s.getState().split('col')
    expect(s.getState().groupRoot).toMatchObject({ kind: 'split', dir: 'row', children: [{ kind: 'split', dir: 'col' }, { kind: 'group' }] })
    expect(s.getState().activeTab).toBe('tab-5')
  })

  test('a new terminal lands in the active group, and one asked from a group that went lands in the active one', async () => {
    const { s, right } = await sideBySide()
    await s.getState().newTab()
    expect(groupTabs(s)).toEqual([['tab-1'], ['tab--1', 'tab--2', 'tab-2']])
    expect(s.getState().activeGroup).toBe(right)
    // A placeholder's group closes while its shell spawns (`terminal-cmd` does this).
    s.getState().openView('terminal-cmd', { cmd: 'x' }, 'split-col')
    const opening = s.getState().openCommandTab('/a', 'claude attach x')
    await s.getState().closePane()
    await opening
    expect(groupTabs(s)).toEqual([['tab-1'], ['tab--1', 'tab--2', 'tab-2', 'tab-3']])
  })

  test('moveTab reorders a row without showing the tab, and a dragged preview is kept', async () => {
    const { s, right } = await sideBySide()
    s.setState((st) => ({ tabs: st.tabs.map((t) => (t.id === 'tab--1' ? { ...t, preview: true } : t)) }))
    s.getState().moveTab('tab--1', { group: right, index: 1 })
    expect(groupTabs(s)).toEqual([['tab-1'], ['tab--2', 'tab--1']])
    expect(s.getState().tabs.map((t) => t.id)).toEqual(['tab-1', 'tab--2', 'tab--1'])
    expect(s.getState().activeTab).toBe('tab--2')
    expect(s.getState().tabs[2].preview).toBeUndefined()
    // To where it already is: nothing at all.
    const before = s.getState().tabs
    s.getState().moveTab('tab--1', { group: right })
    expect(s.getState().tabs).toBe(before)
  })

  test('moveTab into another group shows it there and makes that group active; a group it leaves empty collapses', async () => {
    const { s, left, right } = await sideBySide()
    s.getState().moveTab('tab--2', { group: left, index: 0 })
    expect(groupTabs(s)).toEqual([['tab--2', 'tab-1'], ['tab--1']])
    expect([s.getState().activeGroup, s.getState().activeTab]).toEqual([left, 'tab--2'])
    expect(s.getState().groups[right].activeTab).toBe('tab--1')
    s.getState().moveTab('tab--1', { group: left })
    expect(s.getState().groupRoot).toEqual({ kind: 'group', group: left })
    expect(groupTabs(s)).toEqual([['tab--2', 'tab-1', 'tab--1']])
    expect(s.getState().activeTab).toBe('tab--1')
    // Nothing was closed on the way.
    expect(Object.keys(s.getState().panes).map(Number).sort((a, b) => a - b)).toEqual([-2, -1, 1])
  })

  test('moveTab to a side makes a group there; where that would change nothing, nothing happens', async () => {
    const { s, left, right } = await sideBySide()
    s.getState().moveTab('tab--1', { group: left, side: 'down' })
    const below = s.getState().activeGroup
    expect(s.getState().groupRoot).toEqual({
      kind: 'split',
      dir: 'row',
      ratio: 0.5,
      children: [{ kind: 'split', dir: 'col', ratio: 0.5, children: [{ kind: 'group', group: left }, { kind: 'group', group: below }] }, { kind: 'group', group: right }],
    })
    expect(s.getState().activeTab).toBe('tab--1')
    const before = s.getState()
    // A group's only tab onto its own edge, or onto the facing edge of the group beside it.
    s.getState().moveTab('tab--1', { group: below, side: 'left' })
    s.getState().moveTab('tab-1', { group: below, side: 'up' })
    s.getState().moveTab('tab--1', { group: left, side: 'down' })
    expect(s.getState().groupRoot).toBe(before.groupRoot)
    expect(s.getState().groups).toBe(before.groups)
    // One of two tabs onto its own group's edge splits that group.
    s.getState().focusGroup(right)
    s.getState().openView('marketplace', {}, 'tab')
    s.getState().moveTab('tab--2', { group: right, side: 'right' })
    expect(groupIds(s.getState().groupRoot)).toHaveLength(4)
    expect(s.getState().groups[right].tabs).toEqual(['tab--3'])
    expect(s.getState().activeTab).toBe('tab--2')
  })

  test('detachPane makes a pane of a split terminal tab a tab of its own in the group asked for', async () => {
    const { s, left, right } = await sideBySide()
    s.getState().focusPane(1)
    await s.getState().split('row')
    expect(leaves(s.getState().tabs[0].root)).toEqual([1, 2])
    s.getState().detachPane(2, { group: right, index: 1 })
    expect(groupTabs(s)).toEqual([['tab-1'], ['tab--1', 'tab-2', 'tab--2']])
    expect(s.getState().tabs[0]).toMatchObject({ root: { kind: 'leaf', pane: 1 }, focused: 1 })
    expect(s.getState().tabs.find((t) => t.id === 'tab-2')).toEqual({ id: 'tab-2', root: { kind: 'leaf', pane: 2 }, focused: 2 })
    expect([s.getState().activeGroup, s.getState().activeTab]).toEqual([right, 'tab-2'])
    // A tab's only pane is the tab already; nor is a pane put in a group that is not there.
    const before = s.getState().tabs
    s.getState().detachPane(1, { group: right })
    s.getState().detachPane(2, { group: left })
    s.getState().detachPane(99, { group: left })
    expect(s.getState().tabs).toBe(before)
    // Its first pane leaving a tab named after it, the new tab gets a name of its own.
    s.getState().focusPane(1)
    await s.getState().split('row')
    s.getState().detachPane(1, { group: left })
    expect(groupTabs(s)[0]).toEqual(['tab-1', 'tab-1-2'])
  })

  test('keepTab, activateTab and focusGroup', async () => {
    const { s, left, right } = await sideBySide()
    s.setState((st) => ({ tabs: st.tabs.map((t) => (t.id === 'tab--1' ? { ...t, preview: true } : t)) }))
    s.getState().keepTab('tab--1')
    expect(s.getState().tabs[1]).not.toHaveProperty('preview')
    s.getState().activateTab('tab-1')
    expect([s.getState().activeGroup, s.getState().activeTab]).toEqual([left, 'tab-1'])
    s.getState().activateTab('tab--1')
    expect([s.getState().activeGroup, s.getState().activeTab]).toEqual([right, 'tab--1'])
    s.getState().focusGroup(left)
    expect([s.getState().activeGroup, s.getState().activeTab]).toEqual([left, 'tab-1'])
    // From Home, focusing a group shows its tab again.
    s.getState().showHome()
    expect(s.getState().activeGroup).toBe(left)
    s.getState().focusGroup(right)
    expect(s.getState().activeTab).toBe('tab--1')
    const before = s.getState()
    s.getState().focusGroup('no-such-group')
    s.getState().focusGroup(right)
    expect(s.getState()).toBe(before)
  })

  test('setGroupRatio resizes the seam at a path, held between 15% and 85%', async () => {
    const { s } = await sideBySide()
    s.getState().setGroupRatio([], 0.3)
    expect(s.getState().groupRoot).toMatchObject({ ratio: 0.3 })
    s.getState().setGroupRatio([], 0.01)
    expect(s.getState().groupRoot).toMatchObject({ ratio: 0.15 })
    s.getState().setGroupRatio([], 2)
    expect(s.getState().groupRoot).toMatchObject({ ratio: 0.85 })
    const root = s.getState().groupRoot
    s.getState().setGroupRatio([1], 0.5)
    expect(s.getState().groupRoot).toBe(root)
  })

  test('only terminals move across tabs, and only into a tab of terminals', async () => {
    const { s } = await sideBySide()
    await s.getState().newTab('/b')
    const before = s.getState().tabs
    // The vault is no terminal, and the mission's tab is no tab of terminals.
    s.getState().movePane(-1, 2, 'left', 'tab-2')
    s.getState().movePane(2, -2, 'left', 'tab--2')
    expect(s.getState().tabs).toBe(before)
    s.getState().movePane(2, 1, 'right', 'tab-1')
    expect(leaves(s.getState().tabs[0].root)).toEqual([1, 2])
    expect(s.getState().tabs.map((t) => t.id)).not.toContain('tab-2')
    expect(s.getState().activeTab).toBe('tab-1')
  })

  test('a layout set with its tabs alone works as one group holding them all, in their order', () => {
    const s = createStore(fakePty())
    const tab = (id: number) => ({ id: `t${id}`, root: { kind: 'leaf' as const, pane: id }, focused: id })
    s.setState({ tabs: [tab(1), tab(2)], activeTab: 't2' })
    expect(groupTabs(s)).toEqual([['t1', 't2']])
    expect(s.getState().groups[s.getState().activeGroup].activeTab).toBe('t2')
    // A tab added the same way joins the active group; one taken away leaves its group.
    s.setState((st) => ({ tabs: [...st.tabs, tab(3)], activeTab: 't3' }))
    expect(groupTabs(s)).toEqual([['t1', 't2', 't3']])
    s.setState((st) => ({ tabs: st.tabs.filter((t) => t.id !== 't1') }))
    expect(groupTabs(s)).toEqual([['t2', 't3']])
    // Groups left over from another layout name none of these: they go.
    s.setState({ tabs: [tab(7)], activeTab: '' })
    expect(groupTabs(s)).toEqual([['t7']])
    expect(s.getState().activeTab).toBe('')
    s.getState().goToTab(0)
    expect(s.getState().activeTab).toBe('t7')
    s.setState({ tabs: [], activeTab: '' })
    expect([s.getState().groups, s.getState().groupRoot, s.getState().activeGroup]).toEqual([{}, null, ''])
  })

  test('worktreeLayout reads every open worktree and the tabs of none, the same object until it changes', async () => {
    const s = createStore(fakePty())
    await s.getState().switchWorktree('/a')
    await s.getState().newTab()
    const a = s.getState().worktreeLayout('/a')!
    expect(a).toMatchObject({ tabs: s.getState().tabs, activeTab: 'tab-1', groupRoot: { kind: 'group' } })
    expect(s.getState().worktreeLayout('/a')).toBe(a)
    await s.getState().switchWorktree('/b')
    // Parked as it was: the same object.
    expect(s.getState().worktreeLayout('/a')).toBe(a)
    const b = s.getState().worktreeLayout('/b')!
    expect(b.tabs).toEqual([])
    s.getState().setPalette(true)
    expect(s.getState().worktreeLayout('/b')).toBe(b)
    await s.getState().newTab()
    expect(s.getState().worktreeLayout('/b')).not.toBe(b)
    expect(s.getState().worktreeLayout('/a')).toBe(a)
    await s.getState().switchWorktree('/a')
    expect(s.getState().worktreeLayout('/a')).toBe(a)
    expect(s.getState().worktreeLayout('/nowhere')).toBeUndefined()
    expect(s.getState().worktreeLayout(ELSEWHERE)).toBeUndefined()
    s.setState((st) => ({ parked: { ...st.parked, [ELSEWHERE]: { tabs: [{ id: 'tab-9', root: { kind: 'leaf', pane: 9 }, focused: 9 }], activeTab: '' } as never } }))
    expect(s.getState().worktreeLayout(ELSEWHERE)?.groupRoot).toMatchObject({ kind: 'group' })
  })
})
