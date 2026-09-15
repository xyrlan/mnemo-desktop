import { vi } from 'vitest'
import { createStore, PROMPT_DELAY_MS, type Store } from './store'
import { parseSaved, type Saved } from './saved'
import { startWorkspace, type WorkspaceClient } from './persist'
import type { PtyClient } from '../pty/client'
import type { Node } from './tree'

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
    version: 1,
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
  })
  // Plain JSON: what goes to the file is what comes back.
  expect(JSON.parse(JSON.stringify(saved))).toEqual(saved)
})

test('snapshotForSave leaves transient views out of their tab', async () => {
  const s = createStore(fakePty().pty, { workspace: () => null })
  await s.getState().newTab('/a')
  s.getState().openView('terminal-cmd', { cmd: 'claude attach x' }, 'split-row')
  s.getState().openView('terminal-cmd', { cmd: 'claude attach y' }, 'tab')
  const saved = s.getState().snapshotForSave()
  expect(saved.tabs).toEqual([{ id: 'tab-1', root: leaf(1), focused: 1 }])
  expect(Object.keys(saved.panes)).toEqual(['1'])
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
    const again = s.getState().snapshotForSave()
    expect(again.tabs.map((t) => t.root.kind)).toEqual(['split', 'leaf'])
    expect(Object.values(again.panes)).toEqual([{ view: 'terminal', cwd: '/repo' }, ...Object.values(saved.panes).slice(1)])
  } finally {
    vi.useRealTimers()
  }
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
  const saved = parseSaved(v) as Saved
  expect(saved.tabs).toEqual([
    { id: 'a', root: leaf(1), focused: 1 },
    { id: 'c', root: leaf(4), focused: 4, name: 'kept' },
  ])
  expect(saved.panes).toEqual({ '1': { view: 'terminal', cwd: '/a' }, '4': { view: 'browser', props: { url: 'https://x' } } })
  expect(saved.activeTab).toBe('b')
  expect((parseSaved({ tabs: [{ root: split('row', 7, leaf(1), leaf(2)) }], panes: { '1': { view: 'a' }, '2': { view: 'b' } } }) as Saved).tabs[0].root).toEqual(split('row', 0.9, leaf(1), leaf(2)))
  expect(parseSaved({})).toBeNull()
  expect(() => parseSaved(null)).toThrow()
  expect(() => parseSaved({ tabs: 'x' })).toThrow()
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
      expect((written[0] as Saved).tabs[0].root).toMatchObject({ ratio: 0.7 })

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
      expect((written[0] as Saved).panes).toEqual({ '1': { view: 'terminal', cwd: '/b' } })
      ws.stop()

      const failing = startWorkspace(createStore(fakePty().pty), { read: async () => Promise.reject(new Error('io')), write: async () => {} })
      expect((await failing.ready).notice).toContain('io')
      failing.stop()
    } finally {
      vi.useRealTimers()
    }
  })
})
