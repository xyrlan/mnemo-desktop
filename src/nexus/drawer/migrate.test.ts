import { vi } from 'vitest'
import type { PaneRuns } from '../../chrome/running'
import { createStore, PENDING_MAX, PROMPT_DELAY_MS, type Pane } from '../../layout/store'
import type { PaneId } from '../../layout/tree'
import type { PtyClient } from '../../pty/client'
import { provideSessions, type PtyInfo, type SessionClient } from '../../terminal/sessions'
import { nexusStore } from '../store'
import { fakeHost } from './fixtures'
import { launchDrawer } from './launch'
import { readTabs, TABS_KEY } from './persist'
import { createDrawer } from './sessions'
import { createSessions, RESUME_WINDOW_MS } from './start'

/* A workspace the workbench saved, before the Nexus was the app (#459), as a person upgrading has
   it, through the app's own launch order (`launchDrawer`): the restore, then the workbench's tabs
   pocketed, the drawer's tabs reopened, the shells adopted, and every pane that holds a Claude
   session id asked what runs there (`check`), as again at each session poll (`drawer/app.ts`).

   Four terminals in tabs: pane 1's Claude runs on in the daemon; pane 2 kept its shell but its
   Claude ended while the app was closed (a stale id); pane 3 is a plain shell; pane 4's shell is
   gone, its session `gone-4`. Beside them, one offscreen pane the Nexus started (pane 9, session
   `off-9`), its shell gone too. */

const enc = (s: string) => new TextEncoder().encode(s)

function fakePty(first = 100) {
  let next = first
  const spawned: (string | undefined)[] = []
  const writes: [number, string][] = []
  const killed: number[] = []
  const pty: PtyClient = {
    spawn: async ({ cwd }) => (spawned.push(cwd), next++),
    write: async (id, data) => void writes.push([id, data]),
    resize: async () => {},
    kill: async (id) => void killed.push(id),
    onExit: async () => () => {},
  }
  return { pty, spawned, writes, killed }
}

/** The core's terminals: each attach answered with `screens[id]`; its channel kept in `outputs`. */
function fakeCore(held: PtyInfo[], screens: Record<number, string> = {}) {
  const outputs: Record<number, (b: Uint8Array) => void> = {}
  const client: SessionClient = {
    list: async () => held,
    attach: async (id, onOutput) => {
      if (!held.find((i) => i.id === id)?.alive) throw new Error(`pane ${id} has exited`)
      outputs[id] = onOutput
      return enc(screens[id] ?? '')
    },
  }
  return { client, outputs }
}

/** What the workbench wrote to `workspace.json`: one worktree, four terminal tabs, and the Nexus's
 *  one offscreen pane. */
async function savedByTheWorkbench() {
  const s = createStore(fakePty(1).pty, { workspace: () => null })
  for (let i = 0; i < 4; i++) await s.getState().newTab('/work/mnemo')
  s.getState().setSessionId(1, 'live-1')
  s.getState().setSessionId(2, 'stale-2')
  s.getState().setSessionId(4, 'gone-4')
  return JSON.parse(JSON.stringify({ ...s.getState().snapshotForSave(), offscreen: [{ pane: 9, cwd: '/work/mnemo', sessionId: 'off-9' }] }))
}

const live = (id: number): PtyInfo => ({ id, cwd: '/work/mnemo', pid: 1000 + id, alive: true })

function memory(): Pick<Storage, 'getItem' | 'setItem'> {
  const m = new Map<string, string>()
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) }
}

type Over = {
  /** The terminals the daemon kept: 1–3 unless a reboot took them. */
  held?: PtyInfo[]
  /** Which saved sessions run elsewhere; rejects as `claude agents` failing does. */
  liveSessions?: (ids: string[]) => Promise<string[]>
  /** What the last run saved, else the workbench's workspace; its drawer's tabs; new panes from. */
  saved?: unknown
  storage?: Pick<Storage, 'getItem' | 'setItem'>
  first?: number
}

/** The app's launch over a fresh store, in its order. What runs under each pane's shell is in
 *  `claude`: `busy`, something (a typed command is the shell's child from the moment it is
 *  typed: the fake PTY marks each pane written to), `listed`, a Claude `claude agents` lists;
 *  `cannotTell`, `claude agents` answering on no account. */
async function launch(over: Over = {}) {
  const p = fakePty(over.first)
  const claude = { listed: new Set<PaneId>([1]), busy: new Set<PaneId>([1]), cannotTell: false }
  const write = p.pty.write
  p.pty.write = async (id, data) => (claude.busy.add(id), write(id, data))
  const runs = async (pane: PaneId): Promise<PaneRuns> => {
    if (!claude.busy.has(pane)) return 'idle'
    if (claude.cannotTell) return 'unknown'
    return claude.listed.has(pane) ? 'claude' : 'other'
  }
  const core = fakeCore(over.held ?? [live(1), live(2), live(3)], { 1: 'screen of 1' })
  const layout = createStore(p.pty, {
    workspace: () => null,
    sessions: core.client,
    liveSessions: over.liveSessions ?? (() => Promise.reject(new Error('claude agents failed'))),
  })
  const storage = over.storage ?? memory()
  const { host } = fakeHost()
  let sessions: ReturnType<typeof createSessions> | null = null
  let started: ReturnType<typeof launchDrawer> | null = null
  const drawer = createDrawer(host, nexusStore, { letGo: (pane) => void sessions?.letGo(pane) })
  sessions = createSessions({
    layout,
    drawer,
    nexus: nexusStore,
    skipPermissions: () => true,
    newId: () => 'new-id',
    runs,
    now: Date.now,
  })
  started = launchDrawer({ layout, drawer, nexus: nexusStore, sessions, runs, storage })
  await layout.getState().restore(over.saved ?? (await savedByTheWorkbench()))
  // The session poll's check (`drawer/app.ts`), as a tick runs it.
  const check = () => started!.check()
  return { layout, core, p, drawer, sessions, claude, runs, storage, check, stop: () => started?.stop() }
}

/** The tabs on each pane: [pane, tab id, kind]. */
const onPanes = () =>
  nexusStore
    .getState()
    .tabs.flatMap((t) => (t.key?.startsWith('pane:') ? [[Number(t.key.slice(5)), t.id, t.kind] as const] : []))
    .sort((a, b) => a[0] - b[0])

const tabbed = () => new Set(nexusStore.getState().tabs.flatMap((t) => (t.key?.startsWith('pane:') ? [Number(t.key.slice(5))] : [])))

/** Every live terminal the store keeps that neither a drawer tab nor a live Claude's captain
 *  leads to. */
async function unreachable(w: Awaited<ReturnType<typeof launch>>) {
  const out: PaneId[] = []
  for (const x of Object.values(w.layout.getState().panes) as Pane[]) {
    if (x.view !== 'terminal' || x.exitCode !== undefined) continue
    const captain = !!x.sessionId && w.sessions.paneOf(x.sessionId) === x.id && (await w.runs(x.id)) === 'claude'
    if (!tabbed().has(x.id) && !captain) out.push(x.id)
  }
  return out
}

beforeEach(() => {
  vi.useFakeTimers()
  provideSessions(null)
  nexusStore.setState({ tabs: [], activeTab: null, collapsed: false, focusId: null })
})
afterEach(() => vi.useRealTimers())

test('every terminal a workbench workspace brings back is reachable, in a drawer tab or behind its live Claude’s captain, and keeps its id (#459)', async () => {
  const w = await launch()
  await vi.advanceTimersByTimeAsync(PROMPT_DELAY_MS * 2)
  // Asking which sessions are live failed: nothing was resumed, so the new shells hold their ids.
  expect(w.p.writes).toEqual([])
  expect((Object.values(w.layout.getState().panes) as Pane[]).map((x) => [x.id, x.offscreen, x.sessionId])).toEqual([
    [1, true, 'live-1'],
    [2, true, 'stale-2'],
    [3, true, undefined],
    [100, true, 'off-9'],
    [101, true, 'gone-4'],
  ])
  expect(w.layout.getState()).toMatchObject({ tabs: [], worktrees: [], activeWorktree: null, parked: {} })
  // Nothing was typed, so nothing is coming up: each shell at its prompt has a tab at once.
  expect(await unreachable(w)).toEqual([])
  expect([...tabbed()].sort((a, b) => a - b)).toEqual([2, 3, 100, 101])
  // The next save keeps every pane, offscreen, with its id: nothing is lost.
  expect(w.layout.getState().snapshotForSave().offscreen?.map((o) => [o.pane, o.sessionId])).toEqual([
    [1, 'live-1'],
    [2, 'stale-2'],
    [3, undefined],
    [100, 'off-9'],
    [101, 'gone-4'],
  ])
  w.stop()
})

const reset = () => nexusStore.setState({ tabs: [], activeTab: null, collapsed: false, focusId: null })
const activeKey = () => nexusStore.getState().tabs.find((t) => t.id === nexusStore.getState().activeTab)?.key
const holders = (w: Awaited<ReturnType<typeof launch>>, id: string) => (Object.values(w.layout.getState().panes) as Pane[]).filter((x) => x.sessionId === id).map((x) => x.id)

test('F3: a resume the restore typed is never taken for an idle shell, however slowly its Claude starts: Resume shows it, and once it runs its pane is the captain’s (#460)', async () => {
  // Nothing runs elsewhere: the restore types `claude --resume` into both new shells.
  const w = await launch({ liveSessions: async () => [] })
  await vi.advanceTimersByTimeAsync(PROMPT_DELAY_MS * 2)
  expect(w.p.writes.map(([id, cmd]) => [id, cmd.trim()])).toEqual([
    [100, 'claude --resume off-9'],
    [101, 'claude --resume gone-4'],
  ])
  // 16 s on, with every pane resuming at once: `claude agents` lists neither yet. A poll checks.
  await vi.advanceTimersByTimeAsync(RESUME_WINDOW_MS + 1000)
  await w.check()
  expect([w.sessions.isIdle(100, 'off-9'), w.sessions.isIdle(101, 'gone-4')]).toEqual([false, false])
  // Resume now shows the pane its Claude is starting in: nothing is started, nothing typed.
  const spawned = w.p.spawned.length
  await w.sessions.openSession({ kind: 'claude', root: '/work/mnemo', resume: 'gone-4' })
  expect(w.p.spawned).toHaveLength(spawned)
  expect(activeKey()).toBe('pane:101')
  // Pane 2's shell was found at its prompt, and marked so; then `claude --resume stale-2` was typed there.
  expect(w.sessions.paneOf('stale-2')).toBeNull()
  await w.p.pty.write(2, 'claude --resume stale-2\r')
  await w.sessions.openSession({ kind: 'claude', root: '/work/mnemo', resume: 'stale-2' })
  expect(w.p.spawned).toHaveLength(spawned)
  expect(activeKey()).toBe('pane:2')
  // At 20 s all three are listed: each pane is its session's, and the tabs on them follow.
  for (const pane of [2, 100, 101]) w.claude.listed.add(pane)
  await vi.advanceTimersByTimeAsync(4000)
  await w.check()
  expect([w.sessions.paneOf('stale-2'), w.sessions.paneOf('off-9'), w.sessions.paneOf('gone-4')]).toEqual([2, 100, 101])
  expect(onPanes().filter(([p]) => p !== 3)).toEqual([
    [2, 'stale-2', 'captain'],
    [100, 'off-9', 'captain'],
    [101, 'gone-4', 'captain'],
  ])
  expect([holders(w, 'gone-4'), holders(w, 'off-9'), holders(w, 'stale-2')]).toEqual([[101], [100], [2]])
  expect(w.p.writes).toHaveLength(3)
  w.stop()
})

test('F1: on every launch, a pane that holds an id it no longer runs is a shell’s tab, never that session’s captain’s; one the last build saved as the captain’s is a shell’s again (#460)', async () => {
  const storage = memory()
  const shells = [
    [2, 'session:2', 'session'],
    [3, 'session:3', 'session'],
    [100, 'session:100', 'session'],
    [101, 'session:101', 'session'],
  ]
  const first = await launch({ storage })
  await vi.advanceTimersByTimeAsync(PROMPT_DELAY_MS * 2)
  expect(onPanes()).toEqual(shells)
  const saved = JSON.parse(JSON.stringify(first.layout.getState().snapshotForSave()))
  first.stop()

  // The app quits; the daemon keeps every shell. The next launch, from what this one saved.
  const kept = [live(1), live(2), live(3), live(100), live(101)]
  reset()
  const second = await launch({ storage, saved, held: kept, first: 200 })
  await vi.advanceTimersByTimeAsync(PROMPT_DELAY_MS * 2)
  // A change to the panes, and the poll's checks: still shells' tabs.
  second.layout.getState().setSessionId(3, undefined)
  await second.check()
  await vi.advanceTimersByTimeAsync(RESUME_WINDOW_MS)
  await second.check()
  expect(onPanes()).toEqual(shells)
  // No captain leads to a bare shell: `gone-4`'s opens read-only, not pane 101.
  expect([second.sessions.paneOf('gone-4'), second.sessions.paneOf('stale-2'), second.sessions.paneOf('off-9')]).toEqual([null, null, null])
  expect(second.sessions.paneOf('live-1')).toBe(1)
  expect(await unreachable(second)).toEqual([])
  expect(readTabs(storage).tabs.map((t) => [t.pane, t.kind]).sort(([a], [b]) => Number(a) - Number(b))).toEqual(shells.map(([p, , k]) => [p, k]))
  expect(second.p.writes).toEqual([])
  second.stop()

  // As the build before this one saved it: `gone-4`'s captain tab over pane 101's bare shell.
  storage.setItem(TABS_KEY, JSON.stringify({ tabs: [{ id: 'gone-4', kind: 'captain', label: 'gone', sessionId: 'gone-4', cwd: '/work/mnemo', pane: 101 }], active: 'gone-4' }))
  reset()
  const third = await launch({ storage, saved, held: kept, first: 300 })
  await vi.advanceTimersByTimeAsync(PROMPT_DELAY_MS * 2)
  expect(onPanes().find(([p]) => p === 101)).toEqual([101, 'session:101', 'session'])
  expect(readTabs(storage).tabs.find((t) => t.pane === 101)).toMatchObject({ id: 'session:101', kind: 'session', label: 'shell · mnemo' })
  expect(third.sessions.paneOf('gone-4')).toBeNull()
  // Its id stays on the pane, for a Resume to take up anew.
  expect(holders(third, 'gone-4')).toEqual([101])
  third.stop()
})

test('F2: with claude agents failing, × on a shell tab whose shell runs nothing ends it, and it does not come back; one running something is kept until it ends (#460)', async () => {
  const w = await launch()
  await vi.advanceTimersByTimeAsync(PROMPT_DELAY_MS * 2)
  // `claude` missing, too old for `agents --json --all`, or every account failing.
  w.claude.cannotTell = true
  await w.drawer.close('session:3')
  await vi.advanceTimersByTimeAsync(0)
  expect(w.p.killed).toEqual([3])
  expect(w.layout.getState().panes[3]).toBeUndefined()
  expect(w.layout.getState().snapshotForSave().offscreen?.map((o) => o.pane)).not.toContain(3)
  // Something runs in pane 2's shell: kept, since nobody can say what.
  w.claude.busy.add(2)
  await w.drawer.close('session:2')
  await vi.advanceTimersByTimeAsync(0)
  expect(w.p.killed).toEqual([3])
  expect(w.layout.getState().panes[2]).toBeDefined()
  // A poll's check while it runs keeps it, and opens no tab the person closed.
  await w.check()
  expect(w.layout.getState().panes[2]).toBeDefined()
  expect(tabbed().has(2)).toBe(false)
  // It ended: the next check ends the pane.
  w.claude.busy.delete(2)
  await w.check()
  expect(w.p.killed).toEqual([3, 2])
  expect(w.layout.getState().snapshotForSave().offscreen?.map((o) => o.pane)).not.toContain(2)
  w.stop()
})

test('F5: Resume in the first seconds resumes anew a session whose shell the daemon kept bare; only a pane the restore typed into is shown (#460)', async () => {
  const w = await launch({ liveSessions: async () => [] })
  await vi.advanceTimersByTimeAsync(PROMPT_DELAY_MS * 2)
  // Pane 2 kept its shell, its Claude ended while the app was closed: nothing was typed there.
  const spawned = w.p.spawned.length
  await w.sessions.openSession({ kind: 'claude', root: '/work/mnemo', resume: 'stale-2' })
  expect(w.p.spawned).toHaveLength(spawned + 1)
  expect(holders(w, 'stale-2')).toEqual([102])
  expect(activeKey()).toBe('pane:102')
  // The restore typed `claude --resume gone-4` into pane 101: shown, nothing started.
  await w.sessions.openSession({ kind: 'claude', root: '/work/mnemo', resume: 'gone-4' })
  expect(w.p.spawned).toHaveLength(spawned + 1)
  expect(activeKey()).toBe('pane:101')
  w.stop()
})

test('a reboot with claude agents failing keeps every pane and its id, nothing typed, and each is reachable (#460)', async () => {
  // The daemon is gone with the reboot: no terminal kept running.
  const w = await launch({ held: [] })
  w.claude.cannotTell = true
  await vi.advanceTimersByTimeAsync(PROMPT_DELAY_MS * 2 + RESUME_WINDOW_MS)
  expect(w.p.writes).toEqual([])
  const panes = Object.values(w.layout.getState().panes) as Pane[]
  expect(panes.map((x) => [x.offscreen, x.sessionId, x.renewed])).toEqual([
    [true, 'off-9', true],
    [true, 'live-1', true],
    [true, 'stale-2', true],
    [true, undefined, true],
    [true, 'gone-4', true],
  ])
  expect(w.layout.getState().snapshotForSave().offscreen?.map((o) => o.sessionId)).toEqual(['off-9', 'live-1', 'stale-2', undefined, 'gone-4'])
  // Every shell is at its prompt, nothing typed: each has a tab, whatever `claude agents` says.
  expect(tabbed().size).toBe(5)
  w.stop()
})

test('a stale id is not followed: its pane stays a shell’s tab, no captain leads to it, and Resume starts the session anew (#460)', async () => {
  const w = await launch()
  await vi.advanceTimersByTimeAsync(PROMPT_DELAY_MS * 2 + RESUME_WINDOW_MS)
  expect(nexusStore.getState().tabs.find((t) => t.key === 'pane:2')).toMatchObject({ id: 'session:2', kind: 'session', label: 'shell · mnemo' })
  // Any later change to the panes: the tab is still the shell's, not captain `stale-2`'s.
  w.layout.getState().setSessionId(3, undefined)
  await vi.advanceTimersByTimeAsync(0)
  expect(nexusStore.getState().tabs.find((t) => t.key === 'pane:2')).toMatchObject({ id: 'session:2', kind: 'session' })
  expect(w.sessions.paneOf('stale-2')).toBeNull()
  expect(w.sessions.paneOf('live-1')).toBe(1)
  // Resume: a new pane, which alone holds the id; the shell keeps its tab.
  await w.sessions.openSession({ kind: 'claude', root: '/work/mnemo', resume: 'stale-2' })
  const holders = (Object.values(w.layout.getState().panes) as Pane[]).filter((x) => x.sessionId === 'stale-2').map((x) => x.id)
  expect(holders).toHaveLength(1)
  expect(holders[0]).not.toBe(2)
  expect(tabbed().has(2)).toBe(true)
  w.stop()
})

test('a kept workbench Claude pane no view shows keeps nothing of what it prints: its next view is drawn from the core’s screen (#459)', async () => {
  const w = await launch()
  const frame = enc('x'.repeat(300))
  for (let i = 0; i < 10_000; i++) w.core.outputs[1](frame)
  // Nothing held in the webview for it.
  expect(w.layout.getState().tracked()).not.toContain(1)
  const got: Uint8Array[] = []
  const release = w.layout.getState().attachSink(1, (b) => void got.push(b))
  await vi.advanceTimersByTimeAsync(0)
  expect(new TextDecoder().decode(got[0])).toBe('screen of 1')
  expect(got.reduce((n, b) => n + b.length, 0)).toBeLessThan(1024)
  // Its view closed again: nothing kept either.
  release()
  for (let i = 0; i < 10_000; i++) w.core.outputs[1](frame)
  expect(w.layout.getState().tracked()).not.toContain(1)
  w.stop()
})

test('with no core to ask, a terminal keeps at most PENDING_MAX for its next view, the newest', async () => {
  const p = fakePty(1)
  const outputs: Record<number, (b: Uint8Array) => void> = {}
  const bare = createStore({ ...p.pty, spawn: async (o) => ((outputs[1] = o.onOutput), 1) }, { workspace: () => null })
  await bare.getState().openOffscreen('/w')
  for (let i = 0; i < 10_000; i++) outputs[1](enc(`${String(i).padStart(5, '0')}${'z'.repeat(295)}`))
  const got: Uint8Array[] = []
  bare.getState().attachSink(1, (b) => void got.push(b))
  const text = new TextDecoder().decode(new Uint8Array(got.flatMap((b) => [...b])))
  expect(text.length).toBeLessThanOrEqual(PENDING_MAX)
  expect(text.length).toBeGreaterThan(PENDING_MAX - 300)
  expect(text.endsWith(`09999${'z'.repeat(295)}`)).toBe(true)
})
