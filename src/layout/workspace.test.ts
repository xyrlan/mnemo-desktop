import { vi } from 'vitest'
import { createStore, PROMPT_DELAY_MS, type Store } from './store'
import { parseSaved, type Saved, type SavedWorktree } from './saved'
import { startWorkspace, type WorkspaceClient } from './persist'
import type { PtyClient } from '../pty/client'
import type { PtyInfo, SessionClient } from '../terminal/sessions'
import { groupIds } from './groups'
import { leaves, type Node } from './tree'

function fakePty(first = 1) {
  let next = first
  const spawned: (string | undefined)[] = []
  const writes: [number, string][] = []
  const pty: PtyClient = {
    spawn: async ({ cwd }) => {
      spawned.push(cwd)
      return next++
    },
    write: async (id, data) => void writes.push([id, data]),
    resize: async () => {},
    kill: async () => {},
    onExit: async () => () => {},
  }
  return { pty, spawned, writes }
}

/** The one layout of a workspace that never chose a worktree. */
const loose = (saved: Saved): SavedWorktree => {
  expect(saved.worktrees.map((w) => w.path)).toEqual([null])
  return saved.worktrees[0]
}

const leaf = (pane: number): Node => ({ kind: 'leaf', pane })
const split = (dir: 'row' | 'col', ratio: number, a: Node, b: Node): Node => ({ kind: 'split', dir, ratio, children: [a, b] })

/** Two tabs: a shell beside a resumed Claude session (ratio 0.3) and a cockpit alone, renamed. */
async function sample(): Promise<Store> {
  const s = createStore(fakePty().pty, { workspace: () => null })
  await s.getState().newTab('/repo')
  await s.getState().split('row', '/repo/wt')
  s.getState().setRatio([], 0.3)
  s.getState().setSessionId(2, 'sess-1')
  s.getState().setTitle(1, 'zsh')
  s.getState().openView('cockpit', { x: 1 }, 'tab', 'cockpit')
  s.getState().renameTab(s.getState().activeTab, 'triage')
  s.getState().goToTab(0)
  s.getState().focusPane(1)
  return s
}

test('snapshotForSave keeps trees, ratios, focus, names and what each pane is, not its runtime state', async () => {
  const s = await sample()
  s.getState().paneExited(1, 0)
  const saved = s.getState().snapshotForSave()
  expect(saved).toEqual({
    version: 3,
    activeWorktree: null,
    worktrees: [
      {
        path: null,
        activeTab: 'tab-1',
        tabs: [
          { id: 'tab-1', root: split('row', 0.3, leaf(1), leaf(2)), focused: 1 },
          { id: 'tab--1', root: leaf(-1), focused: -1, name: 'triage' },
        ],
        panes: {
          '1': { view: 'terminal', cwd: '/repo', title: 'zsh' },
          '2': { view: 'terminal', cwd: '/repo/wt', sessionId: 'sess-1' },
          '-1': { view: 'cockpit', props: { x: 1 }, title: 'cockpit' },
        },
        groups: { 'group-1': { id: 'group-1', tabs: ['tab-1', 'tab--1'], activeTab: 'tab-1' } },
        groupRoot: { kind: 'group', group: 'group-1' },
        activeGroup: 'group-1',
      },
    ],
  })
  // Plain JSON: what goes to the file is what comes back.
  expect(JSON.parse(JSON.stringify(saved))).toEqual(saved)
})

test('snapshotForSave leaves transient views out, and a group they leave empty out of the tree', async () => {
  const s = createStore(fakePty().pty, { workspace: () => null })
  await s.getState().newTab('/a')
  s.getState().openView('terminal-cmd', { cmd: 'claude attach x' }, 'split-row')
  s.getState().openView('terminal-cmd', { cmd: 'claude attach y' }, 'tab')
  expect(Object.keys(s.getState().groups)).toHaveLength(2)
  const saved = loose(s.getState().snapshotForSave())
  expect(saved.tabs).toEqual([{ id: 'tab-1', root: leaf(1), focused: 1 }])
  expect(Object.keys(saved.panes)).toEqual(['1'])
  expect(saved).toMatchObject({ groupRoot: { kind: 'group', group: 'group-1' }, activeGroup: 'group-1', activeTab: 'tab-1' })
  expect(Object.keys(saved.groups)).toEqual(['group-1'])
})

test('restore recreates the tabs with new ids, spawns shells in their cwd and resumes the Claude session', async () => {
  vi.useFakeTimers()
  try {
    const saved = JSON.parse(JSON.stringify((await sample()).getState().snapshotForSave()))
    const { pty, spawned, writes } = fakePty(10)
    const s = createStore(pty, { workspace: () => null })
    await s.getState().restore(saved)
    const st = s.getState()
    expect(spawned).toEqual(['/repo', '/repo/wt'])
    expect(st.tabs).toHaveLength(2)
    expect(st.tabs[0]).toEqual({ id: 'tab-10', root: split('row', 0.3, leaf(10), leaf(11)), focused: 10 })
    expect(st.activeTab).toBe('tab-10')
    expect(st.panes[10]).toEqual({ id: 10, view: 'terminal', cwd: '/repo' })
    expect(st.panes[11]).toEqual({ id: 11, view: 'terminal', cwd: '/repo/wt', sessionId: 'sess-1' })
    const cockpit = st.tabs[1]
    expect(cockpit.name).toBe('triage')
    expect(st.panes[cockpit.focused]).toMatchObject({ view: 'cockpit', props: { x: 1 }, title: 'cockpit' })
    expect(cockpit.focused).toBeLessThan(0)

    expect(writes).toEqual([])
    vi.advanceTimersByTime(PROMPT_DELAY_MS)
    expect(writes).toEqual([[11, 'claude --resume sess-1\n']])

    // Saving the restored layout gives the same shape back, less a shell's stale title (the
    // new shell sets its own).
    const again = loose(s.getState().snapshotForSave())
    expect(again.tabs.map((t) => t.root.kind)).toEqual(['split', 'leaf'])
    expect(Object.values(again.panes)).toEqual([{ view: 'terminal', cwd: '/repo' }, ...Object.values(loose(saved).panes).slice(1)])
  } finally {
    vi.useRealTimers()
  }
})

test('restore leaves a session another instance runs alone, and resumes nothing when it cannot tell', async () => {
  vi.useFakeTimers()
  try {
    const src = await sample()
    src.getState().setSessionId(1, 'sess-0')
    const saved = JSON.parse(JSON.stringify(src.getState().snapshotForSave()))

    const asked: string[][] = []
    const one = fakePty(10)
    const s = createStore(one.pty, { workspace: () => null, liveSessions: async (ids) => (asked.push(ids), ['sess-1']) })
    await s.getState().restore(saved)
    expect(asked).toEqual([['sess-0', 'sess-1']])
    vi.advanceTimersByTime(PROMPT_DELAY_MS)
    expect(one.writes).toEqual([[10, 'claude --resume sess-0\n']])
    // The live one stays on its pane, so the layout saves it and a later restore can resume it.
    expect(s.getState().panes[11].sessionId).toBe('sess-1')
    expect(loose(s.getState().snapshotForSave()).panes['11']).toMatchObject({ sessionId: 'sess-1' })

    const two = fakePty(10)
    const blind = createStore(two.pty, { workspace: () => null, liveSessions: () => Promise.reject(new Error('claude: not found')) })
    await blind.getState().restore(saved)
    vi.advanceTimersByTime(PROMPT_DELAY_MS)
    expect(two.writes).toEqual([])
    expect([10, 11].map((id) => blind.getState().panes[id].sessionId)).toEqual(['sess-0', 'sess-1'])
  } finally {
    vi.useRealTimers()
  }
})

test('restore asks nothing when no pane ran a session', async () => {
  const src = createStore(fakePty().pty, { workspace: () => null })
  await src.getState().newTab('/repo')
  let asked = 0
  const s = createStore(fakePty(10).pty, { workspace: () => null, liveSessions: async () => (asked++, []) })
  await s.getState().restore(JSON.parse(JSON.stringify(src.getState().snapshotForSave())))
  expect(asked).toBe(0)
  expect(s.getState().tabs).toHaveLength(1)
})

test('a moved layout saves and restores with the same panes in the same places', async () => {
  const s = await sample()
  s.getState().focusPane(2)
  await s.getState().split('col', '/repo/low')
  // 1 | (2 / 3), focus on 3; move 1 below 3 and keep focus on it.
  s.getState().focusPane(1)
  s.getState().movePane(1, 3, 'down')
  const moved = split('col', 0.5, leaf(2), split('col', 0.5, leaf(3), leaf(1)))
  expect(s.getState().tabs[0].root).toEqual(moved)
  const saved = JSON.parse(JSON.stringify(s.getState().snapshotForSave())) as Saved
  expect(loose(saved).tabs[0]).toEqual({ id: 'tab-1', root: moved, focused: 1 })

  const r = createStore(fakePty(10).pty, { workspace: () => null })
  await r.getState().restore(saved)
  const t = r.getState().tabs[0]
  // Spawned in tree order: 2 → 10, 3 → 11, 1 → 12.
  expect(t).toEqual({ id: 'tab-10', root: split('col', 0.5, leaf(10), split('col', 0.5, leaf(11), leaf(12))), focused: 12 })
  expect([10, 11, 12].map((id) => r.getState().panes[id].cwd)).toEqual(['/repo/wt', '/repo/low', '/repo'])
  expect(loose(r.getState().snapshotForSave()).tabs[0]).toEqual({ id: 'tab-10', root: split('col', 0.5, leaf(10), split('col', 0.5, leaf(11), leaf(12))), focused: 12 })
})

test('restore of nothing restores nothing; of junk tabs rejects; restored tabs go after the open ones', async () => {
  const s = createStore(fakePty().pty, { workspace: () => null })
  await s.getState().restore({})
  await s.getState().restore({ tabs: [] })
  expect(s.getState().tabs).toEqual([])
  await expect(s.getState().restore({ tabs: [{ root: { kind: 'tree' } }] })).rejects.toThrow('no tab could be read')
  await expect(s.getState().restore([])).rejects.toThrow()

  await s.getState().newTab()
  await s.getState().restore({ tabs: [{ id: 'x', root: leaf(-4), focused: -4 }], panes: { '-4': { view: 'vault' } }, activeTab: 'nope' })
  expect(s.getState().tabs.map((t) => s.getState().panes[t.focused].view)).toEqual(['terminal', 'vault'])
  // The saved active tab is gone: the first restored tab shows.
  expect(s.getState().activeTab).toBe(s.getState().tabs[1].id)
})

test('parseSaved drops unreadable panes and tabs, clamps ratios, and never lets a command through as a session id', () => {
  const v = {
    activeTab: 'b',
    tabs: [
      { id: 'a', root: split('row', 7, leaf(1), leaf(2)), focused: 9 },
      { id: 'b', root: split('col', 0.4, leaf(3), leaf(3)), focused: 3 },
      { id: 'c', root: leaf(4), focused: 4, name: 'kept' },
      'junk',
    ],
    panes: {
      '1': { view: 'terminal', cwd: '/a', sessionId: 'abc; rm -rf ~' },
      '2': { view: 42 },
      '3': { view: 'terminal' },
      '4': { view: 'browser', props: { url: 'https://x' }, cwd: 7 },
    },
  }
  // A file from before worktrees: its tabs are the layout of no worktree, in one group.
  const saved = loose(parseSaved(v) as Saved)
  expect(saved.tabs).toEqual([
    { id: 'a', root: leaf(1), focused: 1 },
    { id: 'c', root: leaf(4), focused: 4, name: 'kept' },
  ])
  expect(saved.panes).toEqual({ '1': { view: 'terminal', cwd: '/a' }, '4': { view: 'browser', props: { url: 'https://x' } } })
  // The tab it showed could not be read: none is named, and its group shows its first.
  expect(saved.activeTab).toBe('')
  expect(Object.values(saved.groups)).toEqual([{ id: 'group-1', tabs: ['a', 'c'], activeTab: 'a' }])
  // Two shells, as only terminals share a tab now.
  const two = { '1': { view: 'terminal' }, '2': { view: 'terminal' } }
  expect(loose(parseSaved({ tabs: [{ root: split('row', 7, leaf(1), leaf(2)) }], panes: two }) as Saved).tabs[0].root).toEqual(split('row', 0.9, leaf(1), leaf(2)))
  expect(parseSaved({})).toBeNull()
  expect(() => parseSaved(null)).toThrow()
  expect(() => parseSaved({ tabs: 'x' })).toThrow()
})

describe('per worktree', () => {
  /** `/repo` with a shell beside a Claude session, `/repo-wt-a` with a vault tab; `/repo-wt-a` shown. */
  async function two(): Promise<Store> {
    const s = createStore(fakePty().pty, { workspace: () => null })
    await s.getState().switchWorktree('/repo')
    await s.getState().newTab()
    await s.getState().split('row', '/repo/src')
    s.getState().setSessionId(2, 'sess-2')
    await s.getState().switchWorktree('/repo-wt-a')
    s.getState().openView('vault', {}, 'tab', 'vault')
    await s.getState().switchWorktree('/empty')
    await s.getState().switchWorktree('/repo-wt-a')
    return s
  }

  test('each open worktree saves its own layout, and the file says which is shown', async () => {
    const saved = (await two()).getState().snapshotForSave()
    const one = (group: string, tab: string) => ({ groups: { [group]: { id: group, tabs: [tab], activeTab: tab } }, groupRoot: { kind: 'group', group }, activeGroup: group })
    expect(saved).toEqual({
      version: 3,
      activeWorktree: '/repo-wt-a',
      worktrees: [
        {
          path: '/repo',
          activeTab: 'tab-1',
          tabs: [{ id: 'tab-1', root: split('row', 0.5, leaf(1), leaf(2)), focused: 2 }],
          panes: { '1': { view: 'terminal', cwd: '/repo' }, '2': { view: 'terminal', cwd: '/repo/src', sessionId: 'sess-2' } },
          ...one('group-1', 'tab-1'),
        },
        {
          path: '/repo-wt-a',
          activeTab: 'tab--1',
          tabs: [{ id: 'tab--1', root: leaf(-1), focused: -1 }],
          panes: { '-1': { view: 'vault', props: {}, title: 'vault' } },
          ...one('group-2', 'tab--1'),
        },
        // Open with no tab: it stays open.
        { path: '/empty', activeTab: '', tabs: [], panes: {}, groups: {}, groupRoot: null, activeGroup: '' },
      ],
    })
  })

  test('restore reopens every worktree in its order, the shown one first and shown', async () => {
    vi.useFakeTimers()
    try {
      const saved = JSON.parse(JSON.stringify((await two()).getState().snapshotForSave()))
      // A shell the saved file does not place gets its worktree's path.
      delete saved.worktrees[0].panes['1'].cwd
      // The shown one holds a shell too, beside its vault tab.
      saved.worktrees[1].tabs.push({ id: 'tab-9', root: leaf(9), focused: 9 })
      saved.worktrees[1].panes['9'] = { view: 'terminal', cwd: '/repo-wt-a' }
      const { pty, spawned, writes } = fakePty(10)
      const s = createStore(pty, { workspace: () => null })
      await s.getState().restore(saved)
      const st = s.getState()
      expect(st.openWorktrees()).toEqual(['/repo', '/repo-wt-a', '/empty'])
      expect(st.activeWorktree).toBe('/repo-wt-a')
      expect(st.tabs.map((t) => st.panes[t.focused].view)).toEqual(['vault', 'terminal'])
      expect(st.activeTab).toBe(st.tabs[0].id)
      // The shown worktree's shells come back before the parked ones'.
      expect(spawned).toEqual(['/repo-wt-a', '/repo', '/repo/src'])
      expect(st.worktreeTabs('/repo')).toEqual([{ id: 'tab-11', root: split('row', 0.5, leaf(11), leaf(12)), focused: 12 }])
      expect(st.parked['/repo'].activeTab).toBe('tab-11')
      expect(st.worktreeTabs('/empty')).toEqual([])
      vi.advanceTimersByTime(PROMPT_DELAY_MS)
      expect(writes).toEqual([[12, 'claude --resume sess-2\n']])
    } finally {
      vi.useRealTimers()
    }
  })

  test('restore puts tabs opened before it after each worktree\'s own, and tabs of no worktree into the one shown', async () => {
    const s = createStore(fakePty(10).pty, { workspace: () => null })
    await s.getState().newTab('/home')
    await s.getState().restore({
      version: 2,
      activeWorktree: '/a',
      worktrees: [{ path: '/a', tabs: [{ id: 'x', root: leaf(-4), focused: -4 }], panes: { '-4': { view: 'vault' } }, activeTab: 'x' }],
    })
    expect(s.getState().activeWorktree).toBe('/a')
    expect(s.getState().tabs.map((t) => s.getState().panes[t.focused].view)).toEqual(['terminal', 'vault'])
    expect(s.getState().activeTab).toBe(s.getState().tabs[1].id)
  })

  test('parseSaved keeps each worktree once, drops what is not one, and falls back to the first as shown', () => {
    const tab = { id: 't', root: leaf(1), focused: 1 }
    const panes = { '1': { view: 'terminal' } }
    const saved = parseSaved({
      activeWorktree: '/gone',
      worktrees: [
        { path: '/a', tabs: [tab], panes },
        { path: '/a', tabs: [tab], panes },
        { path: 7, tabs: [tab], panes },
        { path: '', tabs: [tab], panes },
        'junk',
        { path: '/b', tabs: [{ root: 'nope' }] },
        { path: null, tabs: [] },
      ],
    }) as Saved
    expect(saved.worktrees.map((w) => [w.path, w.tabs.length])).toEqual([
      ['/a', 1],
      ['/b', 0],
    ])
    expect(saved.activeWorktree).toBe('/a')
    expect(parseSaved({ activeWorktree: null, worktrees: [{ path: '/a' }, { path: null, tabs: [tab], panes }] })?.activeWorktree).toBeNull()
    expect(parseSaved({ worktrees: [] })).toBeNull()
    expect(parseSaved({ worktrees: [{ path: null, tabs: [] }] })).toBeNull()
    expect(() => parseSaved({ worktrees: {} })).toThrow('worktrees is not a list')
    expect(() => parseSaved({ worktrees: [{ path: '/a', tabs: [{ root: 1 }] }] })).toThrow('no tab could be read')
    expect(() => parseSaved({ worktrees: [{ path: '/a', tabs: 'x' }] })).toThrow('tabs is not a list')
  })

  test('a switch of worktree is a change worth saving', async () => {
    vi.useFakeTimers()
    try {
      const s = createStore(fakePty().pty, { workspace: () => null })
      const written: unknown[] = []
      const ws = startWorkspace(s, { read: async () => ({}), write: async (v) => void written.push(v) }, 500)
      await ws.ready
      await s.getState().switchWorktree('/a')
      vi.advanceTimersByTime(500)
      expect(written).toEqual([{ version: 3, activeWorktree: '/a', worktrees: [{ path: '/a', tabs: [], panes: {}, activeTab: '', groups: {}, groupRoot: null, activeGroup: '' }] }])
      ws.stop()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('startWorkspace', () => {
  const client = (read: unknown | (() => Promise<unknown>)) => {
    const written: unknown[] = []
    const c: WorkspaceClient = {
      read: typeof read === 'function' ? (read as () => Promise<unknown>) : async () => read,
      write: async (v) => void written.push(v),
    }
    return { c, written }
  }

  test('restores first, then writes each change once the layout has been still for the debounce', async () => {
    vi.useFakeTimers()
    try {
      const saved = (await sample()).getState().snapshotForSave()
      const s = createStore(fakePty(20).pty, { workspace: () => null })
      const { c, written } = client(saved)
      const ws = startWorkspace(s, c, 500)
      expect(await ws.ready).toEqual({ notice: null })
      expect(s.getState().tabs).toHaveLength(2)
      // Restoring is not a change worth writing.
      vi.advanceTimersByTime(1000)
      expect(written).toEqual([])

      s.getState().setRatio([], 0.6)
      vi.advanceTimersByTime(300)
      s.getState().setRatio([], 0.7)
      vi.advanceTimersByTime(499)
      expect(written).toEqual([])
      vi.advanceTimersByTime(1)
      expect(written).toHaveLength(1)
      expect(loose(written[0] as Saved).tabs[0].root).toMatchObject({ ratio: 0.7 })

      // Same layout, nothing written; the palette is not layout.
      s.getState().setPalette(true)
      s.getState().setRatio([], 0.7)
      vi.advanceTimersByTime(1000)
      expect(written).toHaveLength(1)

      ws.stop()
      s.getState().setRatio([], 0.2)
      vi.advanceTimersByTime(1000)
      expect(written).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  test('a failed restore settles with a notice and still saves what happens next', async () => {
    vi.useFakeTimers()
    try {
      const s = createStore(fakePty().pty, { workspace: () => null })
      const { c, written } = client({ tabs: [{ root: 'nope' }] })
      const ws = startWorkspace(s, c, 500)
      expect((await ws.ready).notice).toBe('could not restore the last workspace: workspace.json: no tab could be read')
      await s.getState().newTab('/b')
      vi.advanceTimersByTime(500)
      expect(loose(written[0] as Saved).panes).toEqual({ '1': { view: 'terminal', cwd: '/b' } })
      ws.stop()

      const failing = startWorkspace(createStore(fakePty().pty), { read: async () => Promise.reject(new Error('io')), write: async () => {} })
      expect((await failing.ready).notice).toContain('io')
      failing.stop()
    } finally {
      vi.useRealTimers()
    }
  })
})

/** Each group's tabs, in the order the groups are laid out. */
const groupTabs = (l: { groups: Record<string, { tabs: string[] }>; groupRoot: Parameters<typeof groupIds>[0] }) => groupIds(l.groupRoot).map((g) => l.groups[g].tabs)

describe('groups (version 3)', () => {
  test('the group tree and its ratios, each group’s tabs in order and the one it shows, the active group and previews come back', async () => {
    const s = createStore(fakePty().pty, { workspace: () => null })
    await s.getState().newTab('/a')
    s.getState().openView('editor', { path: '/a/x.ts' }, 'split-row', 'x.ts', { preview: true })
    s.getState().openView('vault', {}, 'tab', 'vault')
    s.getState().openView('mission', {}, 'split-col', 'mission')
    s.getState().setGroupRatio([], 0.3)
    s.getState().activateTab('tab--1')
    s.getState().focusPane(1)
    const saved = JSON.parse(JSON.stringify(s.getState().snapshotForSave())) as Saved
    const file = loose(saved)
    expect(file.tabs.map((t) => [t.id, t.preview ?? false])).toEqual([
      ['tab-1', false],
      ['tab--1', true],
      ['tab--2', false],
      ['tab--3', false],
    ])
    expect(file.groupRoot).toMatchObject({ kind: 'split', dir: 'row', ratio: 0.3, children: [{ kind: 'group' }, { kind: 'split', dir: 'col' }] })
    expect(groupTabs(file)).toEqual([['tab-1'], ['tab--1', 'tab--2'], ['tab--3']])

    const r = createStore(fakePty(10).pty, { workspace: () => null })
    await r.getState().restore(saved)
    const st = r.getState()
    // New ids, the same shape: the terminal spawns as 10, the views are issued -1, -2, -3.
    expect(groupTabs(st)).toEqual([['tab-10'], ['tab--1', 'tab--2'], ['tab--3']])
    expect(st.groupRoot).toMatchObject({ kind: 'split', dir: 'row', ratio: 0.3, children: [{ kind: 'group' }, { kind: 'split', dir: 'col', ratio: 0.5 }] })
    const [left, right] = groupIds(st.groupRoot)
    expect([st.activeGroup, st.activeTab]).toEqual([left, 'tab-10'])
    expect(st.groups[right].activeTab).toBe('tab--1')
    expect(st.tabs.map((t) => t.preview ?? false)).toEqual([false, true, false, false])
    expect(st.panes[-1]).toMatchObject({ view: 'editor', props: { path: '/a/x.ts' } })
  })

  test('a version 2 workspace like the maintainer’s comes back whole: every worktree, its terminals, their sessions and faces', async () => {
    vi.useFakeTimers()
    try {
      const v2 = {
        version: 2,
        activeWorktree: '/code/app',
        worktrees: [
          {
            path: '/code/app',
            activeTab: 'tab-3',
            tabs: [
              { id: 'tab-1', root: leaf(1), focused: 1, name: 'agent' },
              // A terminal beside a file, the file focused: it was a split before groups.
              { id: 'tab-3', root: split('row', 0.6, leaf(3), leaf(-2)), focused: -2 },
              { id: 'tab-4', root: split('col', 0.5, leaf(4), leaf(5)), focused: 5 },
            ],
            panes: {
              '1': { view: 'terminal', cwd: '/code/app', sessionId: 'sess-a', face: 'conversation' },
              '3': { view: 'terminal', cwd: '/code/app/src', sessionId: 'sess-b' },
              '-2': { view: 'editor', props: { path: '/code/app/README.md', root: '/code/app' }, title: 'README.md' },
              '4': { view: 'terminal', cwd: '/code/app' },
              '5': { view: 'terminal', cwd: '/code/app', sessionId: 'sess-c' },
            },
          },
          {
            path: '/code/app-wt-login',
            activeTab: 'tab-6',
            tabs: [
              { id: 'tab-6', root: leaf(6), focused: 6 },
              { id: 'tab-7', root: split('row', 0.5, leaf(7), leaf(-3)), focused: 7 },
              { id: 'tab--5', root: leaf(-5), focused: -5 },
            ],
            panes: {
              '6': { view: 'terminal', cwd: '/code/app-wt-login', sessionId: 'sess-d', face: 'conversation' },
              '7': { view: 'terminal', cwd: '/code/app-wt-login' },
              '-3': { view: 'browser', props: { url: 'http://localhost:5173' } },
              '-5': { view: 'mission', props: { id: 'c1' }, title: 'mission' },
            },
          },
          {
            path: '/code/other',
            activeTab: 'tab-8',
            tabs: [
              { id: 'tab-8', root: leaf(8), focused: 8 },
              { id: 'tab-9', root: leaf(9), focused: 9 },
            ],
            panes: { '8': { view: 'terminal', cwd: '/code/other', sessionId: 'sess-e' }, '9': { view: 'terminal', cwd: '/code/other', sessionId: 'sess-f' } },
          },
        ],
      }
      // The core kept five of the eight shells running; three ended while the app was away.
      const alive = [1, 3, 4, 6, 8]
      const held: PtyInfo[] = [1, 3, 4, 5, 6, 7, 8, 9].map((id) => ({ id, cwd: '', pid: 1000 + id, alive: alive.includes(id) }))
      const attached: number[] = []
      const sessions: SessionClient = { list: async () => held, attach: async (id) => (attached.push(id), new Uint8Array()) }
      const { pty, spawned, writes } = fakePty(100)
      const s = createStore(pty, { workspace: () => null, sessions })
      await s.getState().restore(JSON.parse(JSON.stringify(v2)))
      const st = s.getState()

      expect(st.openWorktrees()).toEqual(['/code/app', '/code/app-wt-login', '/code/other'])
      expect(st.activeWorktree).toBe('/code/app')
      // The running shells are attached under their ids, and nothing is typed into them.
      expect(attached).toEqual(alive)
      expect(spawned).toEqual(['/code/app', '/code/app-wt-login', '/code/other'])
      vi.advanceTimersByTime(PROMPT_DELAY_MS)
      expect(writes).toEqual([
        [100, 'claude --resume sess-c\n'],
        [102, 'claude --resume sess-f\n'],
      ])
      const sessionOf = (id: number) => st.panes[id].sessionId
      expect([1, 3, 100, 6, 8, 102].map(sessionOf)).toEqual(['sess-a', 'sess-b', 'sess-c', 'sess-d', 'sess-e', 'sess-f'])
      expect([1, 6].map((id) => st.panes[id].face)).toEqual(['conversation', 'conversation'])

      // One group per worktree, its tabs in order; the file beside a terminal is a tab of its own
      // right after it, and shows, as it had the focus.
      const app = st.worktreeLayout('/code/app')!
      expect(groupTabs(app)).toEqual([['tab-1', 'tab-3', 'tab--1', 'tab-4']])
      expect(app.activeTab).toBe('tab--1')
      expect(app.tabs.map((t) => t.root)).toEqual([leaf(1), leaf(3), leaf(-1), split('col', 0.5, leaf(4), leaf(100))])
      expect(app.tabs[0].name).toBe('agent')
      expect(st.panes[-1]).toMatchObject({ view: 'editor', props: { path: '/code/app/README.md' }, title: 'README.md' })
      const login = st.worktreeLayout('/code/app-wt-login')!
      expect(groupTabs(login)).toEqual([['tab-6', 'tab-101', 'tab--2', 'tab--3']])
      expect(login.activeTab).toBe('tab-6')
      expect(login.tabs.map((t) => leaves(t.root).map((id) => st.panes[id].view))).toEqual([['terminal'], ['terminal'], ['browser'], ['mission']])
      expect(groupTabs(st.worktreeLayout('/code/other')!)).toEqual([['tab-8', 'tab-102']])

      // Saved again, it is a version 3 file of the same.
      const again = s.getState().snapshotForSave()
      expect(again.version).toBe(3)
      expect(again.worktrees.map((w) => groupTabs(w))).toEqual([[['tab-1', 'tab-3', 'tab--1', 'tab-4']], [['tab-6', 'tab-101', 'tab--2', 'tab--3']], [['tab-8', 'tab-102']]])
    } finally {
      vi.useRealTimers()
    }
  })

  test('a tab of no terminal that mixed views is cut into one tab per view, the first keeping its name', () => {
    const saved = parseSaved({
      activeTab: 'a',
      tabs: [
        { id: 'a', root: split('row', 0.5, leaf(1), split('col', 0.5, leaf(-1), leaf(2))), focused: -1, name: 'work' },
        { id: 'b', root: split('row', 0.5, leaf(-4), leaf(-6)), focused: -6, name: 'docs' },
      ],
      panes: { '1': { view: 'terminal' }, '2': { view: 'terminal' }, '-1': { view: 'setup' }, '-4': { view: 'editor' }, '-6': { view: 'browser' } },
    }) as Saved
    const w = loose(saved)
    expect(w.tabs).toEqual([
      { id: 'a', root: split('row', 0.5, leaf(1), leaf(2)), focused: 1, name: 'work' },
      { id: 'a/-1', root: leaf(-1), focused: -1 },
      { id: 'b', root: leaf(-4), focused: -4, name: 'docs' },
      { id: 'b/-6', root: leaf(-6), focused: -6 },
    ])
    // The one holding the focused pane shows in the tab's place.
    expect(w.activeTab).toBe('a/-1')
    expect(groupTabs(w)).toEqual([['a', 'a/-1', 'b', 'b/-6']])
  })

  test('parseSaved reads the groups it can, and every tab lands in one', () => {
    const tab = (id: string, pane: number, more: object = {}) => ({ id, root: leaf(pane), focused: pane, ...more })
    const g = (group: string) => ({ kind: 'group', group })
    const saved = parseSaved({
      version: 3,
      activeWorktree: '/a',
      worktrees: [
        {
          path: '/a',
          activeTab: 't2',
          activeGroup: 'R',
          tabs: [tab('t1', 1), tab('t2', -2, { preview: true }), tab('t3', -3, { preview: true }), tab('t4', 4, { preview: true }), tab('t5', -5)],
          panes: { '1': { view: 'terminal' }, '-2': { view: 'editor' }, '-3': { view: 'editor' }, '4': { view: 'terminal' }, '-5': { view: 'vault' } },
          // `t5` is in no group; `gone` names no tab; the ratio is out of bounds; `X` is not a group.
          groups: { L: { tabs: ['t1', 't4', 'gone'], activeTab: 'gone' }, R: { tabs: ['t2', 't3'], activeTab: 't3' }, X: 7 },
          groupRoot: { kind: 'split', dir: 'row', ratio: 0.99, children: [g('L'), { kind: 'split', dir: 'col', ratio: 0.5, children: [g('R'), g('X')] }] },
        },
      ],
    }) as Saved
    const w = saved.worktrees[0]
    expect(w.groupRoot).toEqual({ kind: 'split', dir: 'row', ratio: 0.85, children: [g('L'), g('R')] })
    expect(groupTabs(w)).toEqual([['t1', 't4'], ['t2', 't3', 't5']])
    expect(w.groups.L.activeTab).toBe('t1')
    expect([w.activeGroup, w.activeTab]).toEqual(['R', 't2'])
    // A terminal is never a preview, and a group has one at most.
    expect(w.tabs.map((t) => [t.id, t.preview ?? false])).toEqual([
      ['t1', false],
      ['t4', false],
      ['t2', true],
      ['t3', false],
      ['t5', false],
    ])
    // No tree at all: one group of every tab, in the file's order.
    const flat = parseSaved({ worktrees: [{ path: '/b', tabs: [tab('x', 1), tab('y', 2)], panes: { '1': { view: 'terminal' }, '2': { view: 'terminal' } }, groupRoot: 'junk' }] }) as Saved
    expect(groupTabs(flat.worktrees[0])).toEqual([['x', 'y']])
  })
})
