import type { Agent } from '../../agent/active'
import type { PaneRuns } from '../../chrome/running'
import { createStore, PROMPT_DELAY_MS } from '../../layout/store'
import type { PtyClient } from '../../pty/client'
import { nexusStore } from '../store'
import { fakeHost, settle } from './fixtures'
import { createDrawer } from './sessions'
import { createSessions, followPanes, labelFor, RESUME_WINDOW_MS, type Sessions } from './start'

/** The layout store on a PTY that records what is done to it: panes are 1, 2, … */
function world(over: { failSpawn?: boolean; skip?: boolean; runs?: (pane: number) => PaneRuns; agent?: () => Agent } = {}) {
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
  const drawer = createDrawer(host, nexusStore, { letGo: (pane) => void sessions?.letGo(pane) })
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
    runs: async (pane) => over.runs?.(pane) ?? 'idle',
    now: Date.now,
    ...(over.agent ? { agent: over.agent } : {}),
  })
  return { layout, host, drawer, sessions, writes, spawned, killed }
}

const tabs = () => nexusStore.getState().tabs.map((t) => ({ id: t.id, kind: t.kind, key: t.key, label: t.label }))
const ID1 = '00000001-0000-4000-8000-000000000000'
/** A pane where a Claude runs in `claude`, something else in `other`, else a shell at its prompt. */
const running = (claude: number[], other: number[] = []) => (p: number): PaneRuns => (claude.includes(p) ? 'claude' : other.includes(p) ? 'other' : 'idle')
const seenAll = { isLive: () => true, isIdle: () => false }

beforeEach(() => {
  nexusStore.setState({ tabs: [], activeTab: null, collapsed: false, focusId: null })
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
    expect(nexusStore.getState()).toMatchObject({ activeTab: ID1 })
    expect(w.host.getState().sessions['pane:1']).toMatchObject({ kind: 'pane', pty: 1 })
    vi.advanceTimersByTime(PROMPT_DELAY_MS)
    expect(w.writes).toEqual([[1, `claude --dangerously-skip-permissions --session-id ${ID1}\n`]])
    expect(w.sessions.paneOf(ID1)).toBe(1)
  } finally {
    vi.useRealTimers()
  }
})

test('the permission setting is Launch agent’s; a resume types claude --resume and keeps the id', async () => {
  vi.useFakeTimers()
  try {
    // The default account active, as with no accounts at all: Claude, typed as before Grok.
    const w = world({ skip: false, agent: () => ({ kind: 'claude', config_dir: null }) })
    await w.sessions.openSession({ kind: 'claude', root: '/work/mnemo' })
    await w.sessions.openSession({ kind: 'claude', root: '/work/mnemo', resume: 'abc' })
    vi.advanceTimersByTime(PROMPT_DELAY_MS)
    expect(w.writes).toEqual([
      [1, `claude --session-id ${ID1}\n`],
      [2, 'claude --resume abc\n'],
    ])
    expect(w.layout.getState().panes[1].agent).toBeUndefined()
    expect(w.layout.getState().snapshotForSave().offscreen).toEqual([
      { pane: 1, cwd: '/work/mnemo', sessionId: ID1 },
      { pane: 2, cwd: '/work/mnemo', sessionId: 'abc' },
    ])
  } finally {
    vi.useRealTimers()
  }
})

const GROK_WORK: Agent = { kind: 'grok', config_dir: '/Users/me/.grok-work' }

test('a Grok account active starts grok in leader mode under the id, approving every tool as Launch agent skips prompts; the pane keeps its account', async () => {
  vi.useFakeTimers()
  try {
    const w = world({ agent: () => GROK_WORK })
    await w.sessions.openSession({ kind: 'claude', root: '/work/mnemo-desktop' })
    expect(tabs()).toEqual([{ id: ID1, kind: 'captain', key: 'pane:1', label: 'grok · mnemo-desktop' }])
    expect(w.layout.getState().panes[1]).toMatchObject({ offscreen: true, sessionId: ID1, agent: GROK_WORK })
    vi.advanceTimersByTime(PROMPT_DELAY_MS)
    // The pane runs on the active account already: grok's own words, nothing in front of them.
    expect(w.writes).toEqual([[1, `grok --leader --always-approve -s ${ID1}\n`]])
    expect(w.sessions.paneOf(ID1)).toBe(1)
  } finally {
    vi.useRealTimers()
  }
})

test('a Grok session resumes on its own account and CLI whatever is active now; one the app never ran resumes on the active one', async () => {
  vi.useFakeTimers()
  try {
    let active: Agent = GROK_WORK
    const w = world({ skip: false, agent: () => active })
    await w.sessions.openSession({ kind: 'claude', root: '/work/mnemo' })
    // Its pane is at its prompt again (grok ended), and the default Claude account is active.
    active = { kind: 'claude', config_dir: null }
    vi.advanceTimersByTime(PROMPT_DELAY_MS + RESUME_WINDOW_MS)
    await w.sessions.openSession({ kind: 'claude', root: '/work/mnemo', resume: ID1 })
    expect(tabs().at(-1)).toEqual({ id: ID1, kind: 'captain', key: 'pane:2', label: 'grok · mnemo' })
    expect(w.layout.getState().panes[1].agent).toBeUndefined()
    expect(w.layout.getState().panes[2]).toMatchObject({ sessionId: ID1, agent: GROK_WORK })
    await w.sessions.openSession({ kind: 'claude', root: '/work/mnemo', resume: 'never-seen' })
    vi.advanceTimersByTime(PROMPT_DELAY_MS)
    expect(w.writes.slice(1)).toEqual([
      [2, `env MNEMO_AGENT=grok GROK_HOME=/Users/me/.grok-work grok --leader -r ${ID1}\n`],
      [3, 'claude --resume never-seen\n'],
    ])
  } finally {
    vi.useRealTimers()
  }
})

test('a resume of a session a pane of the app runs already shows that pane: nothing is started', async () => {
  const w = world({ runs: running([2]) })
  await w.sessions.openSession({ kind: 'claude', root: '/work/mnemo-desktop', resume: 'ended-1' })
  expect(tabs()).toEqual([{ id: 'ended-1', kind: 'captain', key: 'pane:1', label: 'claude · mnemo-desktop' }])
  await w.layout.getState().newTab('/work/mnemo')
  w.layout.getState().setSessionId(2, 'live-2')
  await w.sessions.openSession({ kind: 'claude', root: '/work/mnemo', resume: 'live-2' })
  expect(w.spawned).toEqual(['/work/mnemo-desktop', '/work/mnemo'])
  expect(tabs().at(-1)).toEqual({ id: 'live-2', kind: 'captain', key: 'pane:2', label: 'claude · mnemo' })
})

test('a resume of a session whose pane runs no Claude any more starts it in a new pane, which takes the id (#459)', async () => {
  // A workbench pane kept its id, but its Claude ended while the app was closed: a stale id.
  const w = world()
  await w.layout.getState().newTab('/work/mnemo')
  w.layout.getState().setSessionId(1, 'stale-1')
  await w.sessions.openSession({ kind: 'claude', root: '/work/mnemo', resume: 'stale-1' })
  expect(w.spawned).toEqual(['/work/mnemo', '/work/mnemo'])
  expect(w.layout.getState().panes[1].sessionId).toBeUndefined()
  expect(w.layout.getState().panes[2]).toMatchObject({ offscreen: true, sessionId: 'stale-1' })
  expect(w.sessions.paneOf('stale-1')).toBe(2)
  expect(tabs()).toEqual([{ id: 'stale-1', kind: 'captain', key: 'pane:2', label: 'claude · mnemo' }])
})

test('a resume the app cannot tell about shows the pane holding the id: never a second Claude', async () => {
  const w = world({ runs: () => 'unknown' })
  await w.layout.getState().newTab('/work/mnemo')
  w.layout.getState().setSessionId(1, 'maybe-1')
  await w.sessions.openSession({ kind: 'claude', root: '/work/mnemo', resume: 'maybe-1' })
  expect(w.spawned).toEqual(['/work/mnemo'])
  expect(tabs()).toEqual([{ id: 'maybe-1', kind: 'captain', key: 'pane:1', label: 'claude · mnemo' }])
})

test('a Claude that may still be coming up is never started a second time, however slowly it starts; a pane nothing was typed into resumes anew at once (#460)', async () => {
  vi.useFakeTimers()
  try {
    const at = { claude: [] as number[], other: [] as number[] }
    const w = world({ runs: (p) => running(at.claude, at.other)(p) })
    // The restore gives pane 1 `claude --resume coming-1`: its shell's prompt is not up yet.
    await w.layout.getState().newTab('/work/mnemo')
    w.layout.getState().setSessionId(1, 'coming-1')
    w.layout.getState().typeCommand(1, 'claude --resume coming-1')
    await w.sessions.openSession({ kind: 'claude', root: '/work/mnemo', resume: 'coming-1' })
    expect(w.spawned).toEqual(['/work/mnemo'])
    expect(tabs().at(-1)).toMatchObject({ id: 'coming-1', key: 'pane:1' })
    // Typed: the shell runs it, and `claude agents` has not listed it RESUME_WINDOW_MS on.
    await vi.advanceTimersByTimeAsync(PROMPT_DELAY_MS)
    at.other.push(1)
    await vi.advanceTimersByTimeAsync(RESUME_WINDOW_MS + 1000)
    await w.sessions.openSession({ kind: 'claude', root: '/work/mnemo', resume: 'coming-1' })
    expect(w.spawned).toEqual(['/work/mnemo'])
    // A shell the daemon kept, its Claude ended while the app was closed: nothing coming up there.
    await w.layout.getState().newTab('/work/mnemo')
    w.layout.getState().setSessionId(2, 'ended-2')
    await w.sessions.openSession({ kind: 'claude', root: '/work/mnemo', resume: 'ended-2' })
    expect(w.spawned).toHaveLength(3)
    expect(w.layout.getState().panes[2].sessionId).toBeUndefined()
    expect(w.layout.getState().panes[3]).toMatchObject({ offscreen: true, sessionId: 'ended-2' })
    // A session started here, resumed again at once: still the one pane.
    await w.sessions.openSession({ kind: 'claude', root: '/work/mnemo' })
    const started = w.sessions.paneOf(ID1)!
    await w.sessions.openSession({ kind: 'claude', root: '/work/mnemo', resume: ID1 })
    expect(w.spawned).toHaveLength(4)
    expect(nexusStore.getState().activeTab).toBe(ID1)
    // Pane 1's Claude came and went: its shell is back at its prompt, and the session resumes anew.
    at.other.length = 0
    await w.sessions.openSession({ kind: 'claude', root: '/work/mnemo', resume: 'coming-1' })
    expect(w.spawned).toHaveLength(5)
    expect(w.layout.getState().panes[1].sessionId).toBeUndefined()
    expect(started).toBe(4)
  } finally {
    vi.useRealTimers()
  }
})

test('a pane found at its prompt is no captain’s pane under the id it holds, nor followed by its tab, until a Claude is seen there; a captain’s tab on it is a shell’s again (#460)', async () => {
  const w = world()
  w.layout.setState({ panes: { 7: { id: 7, view: 'terminal', sessionId: 'stale-7', offscreen: true, cwd: '/w' } } })
  nexusStore.setState({ tabs: [{ id: 'session:7', kind: 'session', key: 'pane:7', readOnly: null, label: 'shell · w', sessionId: null, cwd: '/w' }], activeTab: 'session:7' })
  // Held, never seen running: not followed.
  followPanes(nexusStore, w.layout.getState().panes, w.sessions)
  expect(tabs()[0]).toMatchObject({ id: 'session:7', kind: 'session' })
  expect(await w.sessions.observe(7, 'idle')).toBe(false)
  expect(w.sessions.paneOf('stale-7')).toBeNull()
  // Something runs there that is no Claude: the mark stays.
  await w.sessions.observe(7, 'other')
  expect(w.sessions.paneOf('stale-7')).toBeNull()
  // `claude --resume stale-7` typed in it, and seen running: its pane again, and its tab the captain's.
  await w.sessions.observe(7, 'claude')
  expect(w.sessions.paneOf('stale-7')).toBe(7)
  followPanes(nexusStore, w.layout.getState().panes, w.sessions)
  expect(tabs()[0]).toMatchObject({ id: 'stale-7', kind: 'captain' })
  // It ended, the shell is at its prompt again: the captain's tab is a shell's.
  await w.sessions.observe(7, 'idle')
  followPanes(nexusStore, w.layout.getState().panes, w.sessions)
  expect(tabs()[0]).toMatchObject({ id: 'session:7', kind: 'session', label: 'shell · w' })
  expect(w.layout.getState().panes[7].sessionId).toBe('stale-7')
})

test('a pane a tab let go while its Claude ran ends once that Claude does; one never let go, or shown again, does not (#460)', async () => {
  const at = { claude: [1, 2] }
  const w = world({ runs: (p) => running(at.claude)(p) })
  await w.sessions.openSession({ kind: 'claude', root: '/b' })
  await w.drawer.close(ID1)
  await settle()
  expect(w.layout.getState().panes[1]).toBeDefined()
  expect(w.sessions.isReleased(1)).toBe(true)
  at.claude = [2]
  expect(await w.sessions.lost(1)).toBe(true)
  expect(w.killed).toEqual([1])
  // Never let go: left for a tab of its own.
  await w.layout.getState().openOffscreen('/b')
  expect(await w.sessions.lost(2)).toBe(false)
  expect(await w.sessions.observe(2, 'idle')).toBe(false)
  expect(w.killed).toEqual([1])
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
  await expect(world({ failSpawn: true, agent: () => GROK_WORK }).sessions.openSession({ kind: 'claude', root: '/work/mnemo' })).rejects.toThrow('Could not start grok in /work/mnemo: no shell')
  await expect(w.sessions.openSession({ kind: 'shell', root: '/work/mnemo' })).rejects.toThrow('Could not open a terminal in /work/mnemo: no shell')
  expect(tabs()).toEqual([])
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
  const at = { claude: [1] }
  const w = world({ runs: (p) => running(at.claude)(p) })
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
  at.claude = []
  await w.drawer.close(ID1)
  await settle()
  expect(w.killed).toEqual([2, 1])
})

test('× never ends what it cannot tell is done, and ends it once nothing runs; an exited one, or a shell at its prompt, always (#460)', async () => {
  // `claude agents` answering on no account, `claude` missing: what runs cannot be told.
  const at = { busy: [1, 2] }
  const w = world({ runs: (p) => (at.busy.includes(p) ? 'unknown' : 'idle') })
  await w.sessions.openSession({ kind: 'shell', root: '/b' })
  await w.sessions.openSession({ kind: 'shell', root: '/b' })
  await w.sessions.openSession({ kind: 'shell', root: '/b' })
  await w.drawer.close('session:1')
  await w.drawer.close('session:2')
  await settle()
  expect(w.killed).toEqual([])
  // What ran in pane 2 ended: the next look at it ends it.
  at.busy = [1]
  expect(await w.sessions.observe(2, 'idle')).toBe(true)
  expect(w.killed).toEqual([2])
  w.layout.getState().paneExited(1, 0)
  await w.sessions.letGo(1)
  expect(w.killed).toEqual([2, 1])
  // A shell at its prompt runs no Claude, whatever `claude agents` says.
  await w.drawer.close('session:3')
  await settle()
  expect(w.killed).toEqual([2, 1, 3])
})

test('× on a pane kept from the workbench’s tabs ends it as an offscreen one: nothing else shows it (#459)', async () => {
  const w = world({ runs: running([2]) })
  await w.layout.getState().newTab('/c')
  await w.layout.getState().newTab('/c')
  await w.sessions.letGo(1)
  expect(w.killed).toEqual([1])
  expect(w.layout.getState().panes[1]).toBeUndefined()
  // A Claude runs in it: kept, for its captain.
  await w.sessions.letGo(2)
  expect(w.killed).toEqual([1])
  expect(w.layout.getState().panes[2]).toBeDefined()
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
  followPanes(nexusStore, { 4: { sessionId: 'typed-claude' }, 5: { sessionId: 'other' }, 6: { sessionId: 'cap-6' } }, seenAll)
  expect(tabs().map((t) => [t.id, t.kind])).toEqual([
    ['typed-claude', 'captain'],
    ['r-1', 'robot'],
    ['cap-6', 'captain'],
  ])
  expect(nexusStore.getState().tabs[0].sessionId).toBe('typed-claude')
  expect(nexusStore.getState()).toMatchObject({ activeTab: 'typed-claude', focusId: 'typed-claude' })
  // Claude quit: the tab stays the captain's.
  followPanes(nexusStore, { 4: {}, 6: {} }, seenAll)
  expect(tabs()[0].id).toBe('typed-claude')
})
