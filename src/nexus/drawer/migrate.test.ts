import { vi } from 'vitest'
import { createStore, PENDING_MAX, PROMPT_DELAY_MS, type Pane } from '../../layout/store'
import type { PaneId } from '../../layout/tree'
import type { PtyClient } from '../../pty/client'
import { provideSessions, type PtyInfo, type SessionClient } from '../../terminal/sessions'
import { nexusStore } from '../store'
import { fakeHost } from './fixtures'
import { adoptIdle, adoptShells, reopenTabs } from './persist'
import { createDrawer } from './sessions'
import { createSessions } from './start'

/* A workspace the workbench saved, before the Nexus was the app (#459), as a person upgrading has
   it: four terminals in tabs. Pane 1's Claude runs on in the daemon; pane 2 kept its shell but its
   Claude ended while the app was closed (a stale id); pane 3 is a plain shell; pane 4's shell is
   gone, and its session could not be resumed because asking which sessions are live failed. */

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
function fakeCore(held: PtyInfo[], screens: Record<number, string>) {
  const outputs: Record<number, (b: Uint8Array) => void> = {}
  const attached: number[] = []
  const client: SessionClient = {
    list: async () => held,
    attach: async (id, onOutput) => {
      if (!held.find((i) => i.id === id)?.alive) throw new Error(`pane ${id} has exited`)
      attached.push(id)
      outputs[id] = onOutput
      return enc(screens[id] ?? '')
    },
  }
  return { client, outputs, attached }
}

/** What the workbench wrote to `workspace.json`: one worktree, four terminal tabs. */
async function savedByTheWorkbench() {
  const s = createStore(fakePty(1).pty, { workspace: () => null })
  for (let i = 0; i < 4; i++) await s.getState().newTab('/work/mnemo')
  s.getState().setSessionId(1, 'live-1')
  s.getState().setSessionId(2, 'stale-2')
  s.getState().setSessionId(4, 'gone-4')
  return JSON.parse(JSON.stringify(s.getState().snapshotForSave()))
}

const live = (id: number): PtyInfo => ({ id, cwd: '/work/mnemo', pid: 1000 + id, alive: true })

/** The app's launch, as `drawer/app.ts` runs it, over a fresh store restored from that file. */
async function launch() {
  const saved = await savedByTheWorkbench()
  const p = fakePty()
  const core = fakeCore([live(1), live(2), live(3)], { 1: 'screen of 1' })
  const layout = createStore(p.pty, {
    workspace: () => null,
    sessions: core.client,
    liveSessions: () => Promise.reject(new Error('claude agents failed')),
  })
  await layout.getState().restore(saved)
  const { host } = fakeHost()
  let sessions: ReturnType<typeof createSessions> | null = null
  const drawer = createDrawer(host, nexusStore, { letGo: (pane) => void sessions?.letGo(pane) })
  /** Where a Claude runs now: only in pane 1. */
  const runsClaude = async (pane: PaneId) => pane === 1
  sessions = createSessions({ layout, drawer, nexus: nexusStore, skipPermissions: () => true, newId: () => 'new-id', runsClaude })
  layout.getState().pocketTabs()
  reopenTabs({ tabs: [], active: null }, layout.getState().panes, drawer, nexusStore)
  adoptShells(layout.getState().panes, drawer, nexusStore)
  await adoptIdle(() => layout.getState().panes, drawer, nexusStore, runsClaude)
  return { layout, core, p, drawer, sessions, runsClaude }
}

beforeEach(() => {
  provideSessions(null)
  nexusStore.setState({ tabs: [], activeTab: null, collapsed: false, focusId: null })
})

test('every terminal a workbench workspace brings back is reachable: in a drawer tab, or through its live Claude’s captain (#459)', async () => {
  vi.useFakeTimers()
  try {
    const { layout, p, runsClaude } = await launch()
    vi.advanceTimersByTime(PROMPT_DELAY_MS * 2)
    // Asking which sessions are live failed: nothing was resumed, so pane 4's new shell holds a
    // stale id too.
    expect(p.writes).toEqual([])
    const panes = Object.values(layout.getState().panes) as Pane[]
    expect(panes.map((x) => [x.id, x.offscreen, x.sessionId])).toEqual([
      [1, true, 'live-1'],
      [2, true, 'stale-2'],
      [3, true, undefined],
      [100, true, 'gone-4'],
    ])
    // The workbench's layouts are gone; its terminals are the session registry's offscreen panes.
    expect(layout.getState()).toMatchObject({ tabs: [], worktrees: [], activeWorktree: null, parked: {} })
    const shown = new Set(nexusStore.getState().tabs.flatMap((t) => (t.key?.startsWith('pane:') ? [Number(t.key.slice(5))] : [])))
    for (const x of panes) {
      const reachable = shown.has(x.id) || (!!x.sessionId && (await runsClaude(x.id)))
      expect([x.id, reachable]).toEqual([x.id, true])
    }
    expect([...shown].sort((a, b) => a - b)).toEqual([2, 3, 100])
    // The next save keeps them, offscreen, with their ids: nothing is lost.
    expect(layout.getState().snapshotForSave().offscreen?.map((o) => [o.pane, o.sessionId])).toEqual([
      [1, 'live-1'],
      [2, 'stale-2'],
      [3, undefined],
      [100, 'gone-4'],
    ])
  } finally {
    vi.useRealTimers()
  }
})

test('a stale id does not capture Resume: the captain’s session resumes in a new pane, which takes the id (#459)', async () => {
  const { layout, p, sessions } = await launch()
  await sessions.openSession({ kind: 'claude', root: '/work/mnemo', resume: 'stale-2' })
  expect(p.spawned.at(-1)).toBe('/work/mnemo')
  const resumed = Object.values(layout.getState().panes).find((x) => x.sessionId === 'stale-2')!
  expect(resumed.id).not.toBe(2)
  expect(layout.getState().panes[2]?.sessionId).toBeUndefined()
  expect(sessions.paneOf('stale-2')).toBe(resumed.id)
  // A live one is shown where it runs, never started twice.
  const before = p.spawned.length
  await sessions.openSession({ kind: 'claude', root: '/work/mnemo', resume: 'live-1' })
  expect(p.spawned).toHaveLength(before)
  expect(nexusStore.getState().activeTab).toBe('live-1')
})

test('a kept workbench Claude pane no view shows keeps nothing of what it prints: its next view is drawn from the core’s screen (#459)', async () => {
  const { layout, core } = await launch()
  const frame = enc('x'.repeat(300))
  for (let i = 0; i < 10_000; i++) core.outputs[1](frame)
  // Nothing held in the webview for it.
  expect(layout.getState().tracked()).not.toContain(1)
  const got: Uint8Array[] = []
  layout.getState().attachSink(1, (b) => void got.push(b))
  await new Promise((r) => setTimeout(r, 0))
  const bytes = got.reduce((n, b) => n + b.length, 0)
  expect(new TextDecoder().decode(got[0])).toBe('screen of 1')
  expect(bytes).toBeLessThan(1024)
})

test('closing its view again keeps nothing either, and with no core to ask, a terminal keeps at most PENDING_MAX for its next view', async () => {
  const { layout, core } = await launch()
  const release = layout.getState().attachSink(1, () => {})
  await new Promise((r) => setTimeout(r, 0))
  release()
  for (let i = 0; i < 10_000; i++) core.outputs[1](enc('y'.repeat(300)))
  expect(layout.getState().tracked()).not.toContain(1)

  // No core (a test store, a terminal the app spawned with nothing to attach to): the newest kept.
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
