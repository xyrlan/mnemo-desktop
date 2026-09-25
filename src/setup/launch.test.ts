import { vi } from 'vitest'
import { createStore } from '../layout/store'
import { leaves } from '../layout/tree'
import type { PtyClient } from '../pty/client'
import { afterRestore, openIfMissing, showSetup } from './launch'
import type { ToolName, ToolStatus } from './tools'

function fakePty(): PtyClient {
  let next = 1
  return {
    spawn: async () => next++,
    write: async () => {},
    resize: async () => {},
    kill: async () => {},
    onExit: async () => () => {},
  }
}

const rows = (missing: ToolName[]): ToolStatus[] =>
  (['git', 'gh', 'claude', 'mnemo'] as ToolName[]).map((name) => ({ name, path: missing.includes(name) ? null : `/bin/${name}`, version: null, managed: false }))

/** One saved tab holding a terminal, active. */
const savedTerminal = {
  tabs: [{ id: 'tab-1', root: { kind: 'leaf', pane: 1 }, focused: 1 }],
  panes: { 1: { view: 'terminal', cwd: '/w/app' } },
  activeTab: 'tab-1',
}

const setupPanes = (s: ReturnType<typeof createStore>) => Object.values(s.getState().panes).filter((p) => p.view === 'setup')
const activeView = (s: ReturnType<typeof createStore>) => {
  const st = s.getState()
  const tab = st.tabs.find((t) => t.id === st.activeTab)
  return tab && st.panes[tab.focused]?.view
}
const flush = () => new Promise((r) => setTimeout(r, 0))

test('setup opens as the active tab after the restore, not behind the restored tabs', async () => {
  const s = createStore(fakePty())
  const restored = afterRestore(s)
  const opening = openIfMissing({ restored, check: async () => rows(['mnemo']), open: () => showSetup(s, 'tab') })
  await flush()
  // Nothing opens while the workspace is still coming back.
  expect(setupPanes(s)).toHaveLength(0)
  await s.getState().restore(savedTerminal)
  expect(await opening).toBe(true)
  expect(s.getState().tabs).toHaveLength(2)
  expect(activeView(s)).toBe('setup')
})

test('the store’s own restore is put back once it has run', async () => {
  const s = createStore(fakePty())
  const original = s.getState().restore
  const restored = afterRestore(s)
  expect(s.getState().restore).not.toBe(original)
  await s.getState().restore(savedTerminal)
  await restored
  expect(s.getState().restore).toBe(original)
})

test('when the workspace is never restored, the check still opens setup after the wait', async () => {
  vi.useFakeTimers()
  try {
    const s = createStore(fakePty())
    const opening = openIfMissing({ restored: afterRestore(s, 3000), check: async () => rows(['claude']), open: () => showSetup(s, 'tab') })
    await vi.advanceTimersByTimeAsync(2999)
    expect(setupPanes(s)).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(await opening).toBe(true)
    expect(activeView(s)).toBe('setup')
  } finally {
    vi.useRealTimers()
  }
})

test('a restore that has started is waited for however long it takes', async () => {
  vi.useFakeTimers()
  try {
    let spawned!: () => void
    const pty = fakePty()
    const slow: PtyClient = { ...pty, spawn: (o) => new Promise((r) => (spawned = () => r(pty.spawn(o)))) }
    const s = createStore(slow)
    const opening = openIfMissing({ restored: afterRestore(s, 3000), check: async () => rows(['claude']), open: () => showSetup(s, 'tab') })
    const restoring = s.getState().restore(savedTerminal)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(setupPanes(s)).toHaveLength(0)
    spawned()
    await restoring
    await opening
    expect(activeView(s)).toBe('setup')
  } finally {
    vi.useRealTimers()
  }
})

test('with everything present, or with only git and gh missing, setup does not open', async () => {
  for (const missing of [[], ['git', 'gh']] as ToolName[][]) {
    const s = createStore(fakePty())
    const opened = await openIfMissing({ restored: Promise.resolve(), check: async () => rows(missing), open: () => showSetup(s, 'tab') })
    expect(opened).toBe(false)
    expect(s.getState().tabs).toHaveLength(0)
  }
})

test('a failed check opens nothing', async () => {
  const open = vi.fn()
  expect(await openIfMissing({ restored: Promise.resolve(), check: async () => null, open })).toBe(false)
  expect(open).not.toHaveBeenCalled()
})

test('a setup pane already open anywhere is brought forward rather than opened twice', async () => {
  const s = createStore(fakePty())
  await s.getState().restore({
    tabs: [
      { id: 'a', root: { kind: 'leaf', pane: 1 }, focused: 1 },
      { id: 'b', root: { kind: 'split', dir: 'row', ratio: 0.5, children: [{ kind: 'leaf', pane: 2 }, { kind: 'leaf', pane: 3 }] }, focused: 2 },
    ],
    panes: { 1: { view: 'terminal' }, 2: { view: 'terminal' }, 3: { view: 'setup', title: 'setup' } },
    activeTab: 'a',
  })
  showSetup(s, 'tab')
  expect(setupPanes(s)).toHaveLength(1)
  expect(activeView(s)).toBe('setup')
  // A file from before groups: the setup pane beside a terminal comes back as a tab of its own,
  // right after the terminal's, and that tab is what shows.
  expect(s.getState().tabs.map((t) => leaves(t.root).map((p) => s.getState().panes[p].view))).toEqual([['terminal'], ['terminal'], ['setup']])
  expect(s.getState().activeTab).toBe(s.getState().tabs[2].id)
})
