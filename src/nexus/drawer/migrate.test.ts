import { vi } from 'vitest'
import { createStore, PENDING_MAX, PROMPT_DELAY_MS, type Pane } from '../../layout/store'
import type { PaneId } from '../../layout/tree'
import type { PtyClient } from '../../pty/client'
import { provideSessions, type PtyInfo, type SessionClient } from '../../terminal/sessions'
import { nexusStore } from '../store'
import { fakeHost } from './fixtures'
import { launchDrawer } from './launch'
import { createDrawer } from './sessions'
import { createSessions, RESUME_WINDOW_MS } from './start'

/* A workspace the workbench saved, before the Nexus was the app (#459), as a person upgrading has
   it, through the app's own launch order (`launchDrawer`): the restore, then the workbench's tabs
   pocketed, the drawer's tabs reopened, the shells adopted, and `RESUME_WINDOW_MS` later the panes
   that hold a Claude session id asked whether one runs there.

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
}

/** The app's launch over a fresh store, in its order. `running` says where a Claude runs now;
 *  `cannotTell` makes every such question fail, as a `claude agents` answering on no account. */
async function launch(over: Over = {}) {
  const p = fakePty()
  const core = fakeCore(over.held ?? [live(1), live(2), live(3)], { 1: 'screen of 1' })
  const layout = createStore(p.pty, {
    workspace: () => null,
    sessions: core.client,
    liveSessions: over.liveSessions ?? (() => Promise.reject(new Error('claude agents failed'))),
  })
  const claude = { running: new Set<PaneId>([1]), cannotTell: false }
  const runsClaude = async (pane: PaneId) => {
    if (claude.cannotTell) throw new Error('claude agents could not say which Claude sessions run')
    return claude.running.has(pane)
  }
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
    runsClaude,
    restoredAt: () => started?.restoredAt() ?? null,
    now: Date.now,
  })
  started = launchDrawer({ layout, drawer, nexus: nexusStore, sessions, runsClaude, storage: memory(), now: Date.now })
  await layout.getState().restore(await savedByTheWorkbench())
  return { layout, core, p, drawer, sessions, claude, runsClaude, stop: () => started?.stop() }
}

const tabbed = () => new Set(nexusStore.getState().tabs.flatMap((t) => (t.key?.startsWith('pane:') ? [Number(t.key.slice(5))] : [])))

/** Every live terminal the store keeps that neither a drawer tab nor a live Claude's captain
 *  leads to. */
async function unreachable(w: Awaited<ReturnType<typeof launch>>) {
  const out: PaneId[] = []
  for (const x of Object.values(w.layout.getState().panes) as Pane[]) {
    if (x.view !== 'terminal' || x.exitCode !== undefined) continue
    const captain = !!x.sessionId && w.sessions.paneOf(x.sessionId) === x.id && (await w.runsClaude(x.id).catch(() => false))
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
  // At once, the plain shell; the panes that hold an id once their resumes have had their time.
  expect([...tabbed()]).toEqual([3])
  await vi.advanceTimersByTimeAsync(RESUME_WINDOW_MS)
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

test('Resume never starts a second Claude on a session that may still be coming up where the restore resumed it (#460)', async () => {
  // Nothing runs elsewhere: the restore types `claude --resume` into both new shells.
  const w = await launch({ liveSessions: async () => [] })
  await vi.advanceTimersByTimeAsync(PROMPT_DELAY_MS * 2)
  expect(w.p.writes.map(([id, cmd]) => [id, cmd.trim()])).toEqual([
    [100, 'claude --resume off-9'],
    [101, 'claude --resume gone-4'],
  ])
  // `claude agents` does not list them yet: a Resume in the window shows the pane, starts nothing.
  const spawned = w.p.spawned.length
  await w.sessions.openSession({ kind: 'claude', root: '/work/mnemo', resume: 'gone-4' })
  await w.sessions.openSession({ kind: 'claude', root: '/work/mnemo', resume: 'off-9' })
  expect(w.p.spawned).toHaveLength(spawned)
  expect(nexusStore.getState().tabs.filter((t) => t.id === 'gone-4' || t.id === 'off-9').map((t) => t.key)).toEqual(['pane:101', 'pane:100'])
  // Past the window, with `claude agents` failing: still not a second one.
  w.claude.cannotTell = true
  await vi.advanceTimersByTimeAsync(RESUME_WINDOW_MS)
  await w.sessions.openSession({ kind: 'claude', root: '/work/mnemo', resume: 'stale-2' })
  expect(w.p.spawned).toHaveLength(spawned)
  expect(nexusStore.getState().tabs.find((t) => t.id === nexusStore.getState().activeTab)?.key).toBe('pane:2')
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
  // Nothing can say what runs where: every pane has a tab, which is no harm.
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
