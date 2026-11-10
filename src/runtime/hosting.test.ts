import { sessionsOf } from '../mcp/sessions'
import { shownSession } from '../notify/decide'
import { resolveTarget } from '../voice/route'
import { ATTACH_SETTLE_MS, CHILD_ENDED, GONE, KEEP_ATTACHED, NOT_HERE, OUTSIDE } from './hosting'
import { hostingBench } from './testing'

let b: ReturnType<typeof hostingBench>

beforeEach(() => {
  vi.useFakeTimers()
  b = hostingBench()
})
afterEach(() => {
  b.stop()
  vi.useRealTimers()
})

const settle = () => vi.advanceTimersByTimeAsync(ATTACH_SETTLE_MS + 1)
const spawns = () => b.pty.log.filter((l) => l.startsWith('spawn')).length
/** What the desktop MCP's `desktop_list_panes` says is on screen. */
const onScreen = () =>
  sessionsOf({ tabs: b.nexus().tabs, activeTab: b.nexus().activeTab, collapsed: b.nexus().collapsed, hosted: b.host.getState().sessions, panes: {} })
    .filter((s) => s.shown)
    .map((s) => s.sessionId ?? s.tab)

/** The world with one session changed. */
function patch(id: string, over: Record<string, unknown>) {
  b.state.world = { ...b.state.world, sessions: b.state.world.sessions.map((x) => (x.id === id ? { ...x, ...over } : x)) }
  return b.state.world.sessions.find((x) => x.id === id)!
}

describe('what can be shown live', () => {
  test("a session in one of the app's terminals, a live child, and nothing else", () => {
    const inPane = b.session('Order status history')
    const outside = b.session('Dark theme contrast')
    const liveChild = b.session('Tenant in every cache key')
    const endedChild = b.session('Shell completions for fish')
    b.run(inPane)
    expect(b.hosting.canHost(inPane)).toBe(true)
    expect(b.hosting.canHost(liveChild)).toBe(true)
    expect(b.hosting.canHost(outside)).toBe(false)
    expect(b.hosting.canHost(endedChild)).toBe(false)
    expect(b.hosting.wayOf(outside)).toEqual({ kind: 'none', why: OUTSIDE })
    expect(b.hosting.wayOf(endedChild)).toEqual({ kind: 'none', why: CHILD_ENDED })
  })

  test('an ended session the maintainer talks to is resumed, not shown', () => {
    const s = patch(b.session('Release 2.4 checklist').id, { live: false })
    expect(b.hosting.canHost(s)).toBe(false)
    expect(b.hosting.wayOf(s)).toEqual({ kind: 'resume', root: s.cwd })
  })
})

describe('the stage', () => {
  test('a session in a terminal here is held the moment it is on stage, and is what is on screen', () => {
    const s = b.session('Order status history')
    const pane = b.run(s)
    expect(b.nexus().tabs).toEqual([])
    b.go({ view: 'console', session: s.id })
    expect(b.hosting.view(s.id)).toEqual({ state: 'held', tab: s.id, pty: pane, error: null })
    expect(onScreen()).toEqual([s.id])
    expect(b.pty.log).toEqual([])
  })

  test('off Console nothing is on screen, and the terminal stays held', () => {
    const s = b.session('Order status history')
    b.run(s)
    b.go({ view: 'console', session: s.id })
    b.go({ view: 'orbit' })
    expect(onScreen()).toEqual([])
    expect(b.hosting.hosted().map((h) => h.id)).toEqual([s.id])
    b.go({ view: 'console' })
    expect(onScreen()).toEqual([s.id])
  })

  test('a child is attached to once it has stayed on stage, and not while the roster is walked', async () => {
    const first = b.session('Tenant in every cache key')
    const second = b.session('Webhook signature check')
    b.go({ view: 'console', session: first.id })
    expect(b.hosting.view(first.id)).toEqual({ state: 'waiting' })
    await vi.advanceTimersByTimeAsync(ATTACH_SETTLE_MS - 50)
    b.go({ session: second.id })
    await settle()
    expect(spawns()).toBe(1)
    expect(b.hosting.view(first.id)).toEqual({ state: 'waiting' })
    expect(b.hosting.view(second.id)).toMatchObject({ state: 'held', tab: second.short })
    expect(b.pty.log.some((l) => l.includes(`claude attach ${second.short}`))).toBe(true)
    expect(onScreen()).toEqual([second.id])
  })

  test('the world changing while a child waits starts one attach, not one per change', async () => {
    const s = b.session('Tenant in every cache key')
    b.go({ view: 'console', session: s.id })
    for (let i = 0; i < 5; i++) b.changed()
    await settle()
    for (let i = 0; i < 5; i++) b.changed()
    await settle()
    expect(spawns()).toBe(1)
  })

  test(`at most ${KEEP_ATTACHED} attaches are kept: the oldest off stage is let go, and its child runs on`, async () => {
    const children = b.state.world.sessions.filter((s) => s.role === 'child')
    for (const c of children) patch(c.id, { live: true })
    b.state.snapshot = { ...b.state.snapshot, repos: b.state.snapshot.repos.map((r) => ({ ...r, children: r.children.map((c) => ({ ...c, live: true })) })) }
    expect(children.length).toBeGreaterThan(KEEP_ATTACHED)
    for (const s of children.slice(0, KEEP_ATTACHED + 1)) {
      b.go({ view: 'console', session: s.id })
      await settle()
    }
    expect(b.hosting.hosted().map((h) => h.id)).toEqual(children.slice(1, KEEP_ATTACHED + 1).map((s) => s.short))
    // Let go of by ending its attach's PTY: never `claude stop`.
    expect(b.pty.log.some((l) => l.includes('claude stop'))).toBe(false)
    expect(b.pty.log.filter((l) => l.startsWith('kill'))).toHaveLength(1)
  })

  test('a terminal another path opens does not take the screen from the stage', () => {
    const s = b.session('Order status history')
    b.run(s)
    b.go({ view: 'console', session: s.id })
    b.drawer.open({ id: 'session:90', kind: 'session', key: null, readOnly: null, label: 'shell', sessionId: null, cwd: '/Users/you/work' }, { pane: 90 })
    expect(onScreen()).toEqual([s.id])
    b.go({ view: 'score' })
    expect(onScreen()).toEqual([])
    expect(b.hosting.hosted().map((h) => h.id)).toEqual([s.id, 'session:90'])
  })

  test('a shell the app holds is shown by its own id', () => {
    b.drawer.open({ id: 'session:90', kind: 'session', key: null, readOnly: null, label: 'shell', sessionId: null, cwd: '/Users/you/work' }, { pane: 90 })
    b.go({ view: 'console', session: 'session:90' })
    expect(b.hosting.view('session:90')).toEqual({ state: 'held', tab: 'session:90', pty: 90, error: null })
    expect(onScreen()).toEqual(['session:90'])
    expect(b.hosting.paneOf('session:90')).toBe(90)
  })

  test('a terminal closed while on stage is not taken back until it is asked for', async () => {
    const s = b.session('Tenant in every cache key')
    b.go({ view: 'console', session: s.id })
    await settle()
    await b.drawer.close(s.short)
    b.changed()
    await settle()
    expect(b.hosting.view(s.id)).toEqual({ state: 'detached' })
    expect(spawns()).toBe(1)
    expect(await b.hosting.open(s.id)).toEqual({ ok: true })
    expect(b.hosting.view(s.id)).toMatchObject({ state: 'held' })
    expect(spawns()).toBe(2)
  })

  test('leaving and coming back takes a closed terminal again', async () => {
    const s = b.session('Order status history')
    b.run(s)
    b.go({ view: 'console', session: s.id })
    await b.drawer.close(s.id)
    expect(b.hosting.view(s.id)).toEqual({ state: 'detached' })
    b.go({ session: b.session('Dark theme contrast').id })
    b.go({ session: s.id })
    expect(b.hosting.view(s.id)).toMatchObject({ state: 'held' })
  })
})

describe('what the rest of the app reads', () => {
  test('dictation types into the terminal on stage, and nowhere when none is', () => {
    const s = b.session('Order status history')
    const pane = b.run(s)
    const where = () => resolveTarget(null, { nexus: b.nexus(), sessions: b.host.getState().sessions, layout: { panes: {} } })
    expect(where()).toBeNull()
    b.go({ view: 'console', session: s.id })
    expect(where()).toEqual({ kind: 'pty', pane })
    b.go({ view: 'orbit' })
    expect(where()).toBeNull()
  })

  test('the notifier knows the session on stage as the one on screen', () => {
    const s = b.session('Order status history')
    b.run(s)
    expect(shownSession(b.nexus(), [])).toBeNull()
    b.go({ view: 'console', session: s.id })
    expect(shownSession(b.nexus(), [])?.sessionId).toBe(s.id)
    b.go({ session: b.session('Dark theme contrast').id })
    expect(shownSession(b.nexus(), [])).toBeNull()
  })
})

describe('open and close', () => {
  test('opening an ended session resumes it on its own account, in its folder', async () => {
    const s = patch(b.session('Release 2.4 checklist').id, { live: false })
    b.state.agentFor = s.id
    b.go({ view: 'console', session: s.id })
    expect(b.opened).toEqual([])
    expect(await b.hosting.open(s.id)).toEqual({ ok: true, note: 'Resumed in a terminal here.' })
    expect(b.opened).toEqual([{ kind: 'claude', root: s.cwd, resume: s.id, agent: { kind: 'grok', config_dir: '/Users/you/.grok-work' } }])
    expect(b.hosting.canHost(s)).toBe(true)
    expect(onScreen()).toEqual([s.id])
  })

  test('a session that runs in another terminal is refused, with why, and nothing starts', async () => {
    expect(await b.hosting.open(b.session('Dark theme contrast').id)).toEqual({ ok: false, why: OUTSIDE })
    expect(await b.hosting.open(b.session('Shell completions for fish').id)).toEqual({ ok: false, why: CHILD_ENDED })
    expect(await b.hosting.open('nobody')).toEqual({ ok: false, why: GONE })
    expect(b.opened).toEqual([])
    expect(b.pty.log).toEqual([])
  })

  test("closing ends a session's terminal here, lets go of an attach, and refuses the rest", async () => {
    const s = b.session('Order status history')
    const pane = b.run(s)
    b.go({ view: 'console', session: s.id })
    expect((await b.hosting.close(s.id)).ok).toBe(true)
    expect(b.ended).toEqual([pane])
    expect(b.hosting.hosted()).toEqual([])

    const child = b.session('Tenant in every cache key')
    b.go({ session: child.id })
    await settle()
    expect(await b.hosting.close(child.id)).toEqual({ ok: true, note: 'Let go of. It runs on.' })
    expect(b.ended).toEqual([pane])
    b.changed()
    await settle()
    expect(b.hosting.hosted()).toEqual([])

    expect(await b.hosting.close(b.session('Dark theme contrast').id)).toEqual({ ok: false, why: NOT_HERE })
  })
})
