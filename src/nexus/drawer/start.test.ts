import { createStore, PROMPT_DELAY_MS } from '../../layout/store'
import type { PtyClient } from '../../pty/client'
import { nexusStore } from '../store'
import { fakeHost, settle } from './fixtures'
import { createDrawer } from './sessions'
import { claudeCommand, createSessions, followPanes, labelFor, type Sessions } from './start'

/** The layout store on a PTY that records what is done to it: panes are 1, 2, … */
function world(over: { failSpawn?: boolean; skip?: boolean; runsClaude?: (pane: number) => Promise<boolean> } = {}) {
  const writes: [number, string][] = []
  const spawned: (string | undefined)[] = []
  const killed: number[] = []
  let next = 1
  const pty: PtyClient = {
    spawn: async ({ cwd }) => {
      if (over.failSpawn) throw new Error('no shell')
      spawned.push(cwd)
      return next++
    },
    write: async (id, d) => void writes.push([id, d]),
    resize: async () => {},
    kill: async (id) => void killed.push(id),
    onExit: async () => () => {},
  }
  const layout = createStore(pty)
  const { host } = fakeHost()
  let sessions: Sessions | null = null
  const drawer = createDrawer(host, nexusStore, { goToPane: () => {}, attach: () => {}, closeNexus: () => {}, letGo: (pane) => void sessions?.letGo(pane) })
  // The app drops a closed pane's session from the host (`session/app-host.ts`).
  layout.subscribe((s, prev) => {
    for (const id of Object.keys(prev.panes)) if (!s.panes[Number(id)]) host.getState().paneGone(Number(id))
  })
  let ids = 0
  sessions = createSessions({
    layout,
    drawer,
    nexus: nexusStore,
    skipPermissions: () => over.skip ?? true,
    newId: () => `0000000${++ids}-0000-4000-8000-000000000000`,
    runsClaude: over.runsClaude ?? (async () => false),
  })
  return { layout, host, drawer, sessions, writes, spawned, killed }
}

const tabs = () => nexusStore.getState().tabs.map((t) => ({ id: t.id, kind: t.kind, key: t.key, label: t.label }))
const ID1 = '00000001-0000-4000-8000-000000000000'

beforeEach(() => {
  nexusStore.setState({ open: false, tabs: [], activeTab: null, collapsed: false, focusId: null })
})

test('claude starts in the repo as Launch agent types it, under an id of its own, in a pane no tab shows, its tab its captain’s', async () => {
  vi.useFakeTimers()
  try {
    const w = world()
    await w.sessions.openSession({ kind: 'claude', root: '/work/mnemo-desktop' })
    expect(w.spawned).toEqual(['/work/mnemo-desktop'])
    expect(w.layout.getState().panes[1]).toMatchObject({ offscreen: true, sessionId: ID1, cwd: '/work/mnemo-desktop' })
    expect(w.layout.getState().tabs).toEqual([])
    expect(tabs()).toEqual([{ id: ID1, kind: 'captain', key: 'pane:1', label: 'claude · mnemo-desktop' }])
    expect(nexusStore.getState()).toMatchObject({ open: true, activeTab: ID1 })
    expect(w.host.getState().sessions['pane:1']).toMatchObject({ kind: 'pane', pty: 1 })
    vi.advanceTimersByTime(PROMPT_DELAY_MS)
    expect(w.writes).toEqual([[1, `claude --dangerously-skip-permissions --session-id ${ID1}\n`]])
    expect(w.sessions.paneOf(ID1)).toBe(1)
  } finally {
    vi.useRealTimers()
  }
})

test('the permission setting is Launch agent’s; a resume types claude --resume and keeps the id', () => {
  expect(claudeCommand(false, { sessionId: 'abc' })).toBe('claude --session-id abc')
  expect(claudeCommand(true, { resume: 'abc' })).toBe('claude --dangerously-skip-permissions --resume abc')
  expect(claudeCommand(false, { resume: 'abc' })).toBe('claude --resume abc')
})

test('a resume of a session a pane of the app runs already shows that pane: nothing is started', async () => {
  const w = world()
  await w.sessions.openSession({ kind: 'claude', root: '/work/mnemo-desktop', resume: 'ended-1' })
  expect(tabs()).toEqual([{ id: 'ended-1', kind: 'captain', key: 'pane:1', label: 'claude · mnemo-desktop' }])
  await w.layout.getState().newTab('/work/mnemo')
  w.layout.getState().setSessionId(2, 'live-2')
  await w.sessions.openSession({ kind: 'claude', root: '/work/mnemo', resume: 'live-2' })
  expect(w.spawned).toEqual(['/work/mnemo-desktop', '/work/mnemo'])
  expect(tabs().at(-1)).toEqual({ id: 'live-2', kind: 'captain', key: 'pane:2', label: 'claude · mnemo' })
})

test('a resume after Claude exited in its tab shows the new pane in that tab, in its place, and the shell left ends', async () => {
  const w = world()
  await w.sessions.openSession({ kind: 'claude', root: '/b' })
  await w.sessions.openSession({ kind: 'shell', root: '/b' })
  // Claude quits in pane 1: the session poll clears its session; the tab still shows the shell left.
  w.layout.getState().setSessionId(1, undefined)
  expect(w.sessions.paneOf(ID1)).toBeNull()
  await w.sessions.openSession({ kind: 'claude', root: '/b', resume: ID1 })
  await settle()
  expect(tabs()).toEqual([
    { id: ID1, kind: 'captain', key: 'pane:3', label: 'claude · b' },
    { id: 'session:2', kind: 'session', key: 'pane:2', label: 'shell · b' },
  ])
  expect(nexusStore.getState().activeTab).toBe(ID1)
  expect(w.host.getState().sessions['pane:1']).toBeUndefined()
  expect(w.killed).toEqual([1])
  // Its captain opens the revived session.
  expect(w.sessions.paneOf(ID1)).toBe(3)
})

test('a shell, and a saved command typed once the prompt is up, each in a tab named for what it runs', async () => {
  vi.useFakeTimers()
  try {
    const w = world()
    await w.sessions.openSession({ kind: 'shell', root: '/work/mnemo' })
    await w.sessions.openSession({ kind: 'command', root: '/work/mnemo', command: 'pnpm dev', label: 'dev server' })
    expect(tabs()).toEqual([
      { id: 'session:1', kind: 'session', key: 'pane:1', label: 'shell · mnemo' },
      { id: 'session:2', kind: 'session', key: 'pane:2', label: 'dev server' },
    ])
    vi.advanceTimersByTime(PROMPT_DELAY_MS)
    expect(w.writes).toEqual([[2, 'pnpm dev\n']])
    expect(labelFor({ kind: 'shell', root: '/' })).toBe('shell · /')
  } finally {
    vi.useRealTimers()
  }
})

test('a session that cannot start rejects with why, for its caller to say, and nothing is opened', async () => {
  const w = world({ failSpawn: true })
  await expect(w.sessions.openSession({ kind: 'claude', root: '/work/mnemo' })).rejects.toThrow('Could not start claude in /work/mnemo: no shell')
  await expect(w.sessions.openSession({ kind: 'shell', root: '/work/mnemo' })).rejects.toThrow('Could not open a terminal in /work/mnemo: no shell')
  expect(tabs()).toEqual([])
  expect(nexusStore.getState().open).toBe(false)
})

test('paneOf: the live terminal running the session, offscreen or in a tab; null for one that exited or none', async () => {
  const w = world()
  await w.layout.getState().newTab('/a')
  w.layout.getState().setSessionId(1, 'in-tab')
  await w.sessions.openSession({ kind: 'claude', root: '/b' })
  expect(w.sessions.paneOf('in-tab')).toBe(1)
  expect(w.sessions.paneOf(ID1)).toBe(2)
  w.layout.getState().paneExited(1, 0)
  expect(w.sessions.paneOf('in-tab')).toBeNull()
  expect(w.sessions.paneOf('elsewhere')).toBeNull()
  expect(w.sessions.paneOf('')).toBeNull()
})

test('endSession closes the pane, ends its terminal, and takes its tab; a workbench pane too', async () => {
  const w = world()
  await w.sessions.openSession({ kind: 'claude', root: '/b' })
  await w.sessions.openSession({ kind: 'shell', root: '/b' })
  await w.sessions.endSession(1)
  expect(w.killed).toEqual([1])
  expect(w.layout.getState().panes[1]).toBeUndefined()
  expect(tabs().map((t) => t.id)).toEqual(['session:2'])
  await w.layout.getState().newTab('/c')
  await w.sessions.endSession(3)
  expect(w.killed).toEqual([1, 3])
  expect(w.layout.getState().tabs).toEqual([])
})

test('× on a shell’s tab ends its shell; on a Claude session’s, the session runs on and its captain opens it again', async () => {
  const running = new Set([1])
  const w = world({ runsClaude: async (p) => running.has(p) })
  await w.sessions.openSession({ kind: 'claude', root: '/b' })
  await w.sessions.openSession({ kind: 'shell', root: '/b' })
  await w.drawer.close('session:2')
  await settle()
  expect(w.killed).toEqual([2])
  expect(w.layout.getState().panes[2]).toBeUndefined()
  await w.drawer.close(ID1)
  await settle()
  expect(w.killed).toEqual([2])
  expect(w.layout.getState().panes[1]).toMatchObject({ offscreen: true })
  // Claude quit in it: the shell left has nothing to come back from.
  w.drawer.open({ id: ID1, kind: 'captain', key: null, readOnly: null, label: 'claude', sessionId: ID1, cwd: '/b' }, { pane: 1 })
  running.clear()
  await w.drawer.close(ID1)
  await settle()
  expect(w.killed).toEqual([2, 1])
})

test('× never ends what it cannot tell is done, an exited one always, and a workbench pane never', async () => {
  const w = world({ runsClaude: async () => Promise.reject(new Error('cannot tell')) })
  await w.sessions.openSession({ kind: 'shell', root: '/b' })
  await w.drawer.close('session:1')
  await settle()
  expect(w.killed).toEqual([])
  w.layout.getState().paneExited(1, 0)
  await w.sessions.letGo(1)
  expect(w.killed).toEqual([1])
  await w.layout.getState().newTab('/c')
  await w.sessions.letGo(2)
  expect(w.killed).toEqual([1])
})

test('a tab follows the Claude session its pane runs; a robot’s never does', () => {
  nexusStore.setState({
    tabs: [
      { id: 'session:4', kind: 'session', key: 'pane:4', readOnly: null, label: 'shell · b', sessionId: null, cwd: '/b' },
      { id: 'r-1', kind: 'robot', key: 'pane:5', readOnly: null, label: '#1', sessionId: 's-1', cwd: '/b' },
      { id: 'cap-6', kind: 'captain', key: 'pane:6', readOnly: null, label: 'claude', sessionId: 'cap-6', cwd: '/b' },
    ],
    activeTab: 'session:4',
  })
  followPanes(nexusStore, { 4: { sessionId: 'typed-claude' }, 5: { sessionId: 'other' }, 6: { sessionId: 'cap-6' } })
  expect(tabs().map((t) => [t.id, t.kind])).toEqual([
    ['typed-claude', 'captain'],
    ['r-1', 'robot'],
    ['cap-6', 'captain'],
  ])
  expect(nexusStore.getState().tabs[0].sessionId).toBe('typed-claude')
  expect(nexusStore.getState()).toMatchObject({ activeTab: 'typed-claude', focusId: 'typed-claude' })
  // Claude quit: the tab stays the captain's.
  followPanes(nexusStore, { 4: {}, 6: {} })
  expect(tabs()[0].id).toBe('typed-claude')
})
