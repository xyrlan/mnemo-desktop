import { sessionOf } from '../store'
import type { World } from '../types'
import { buildWorld } from './build'
import { CLOCK_MS, createLive, READ_MS } from './engine'
import { child, CHILD, fakeSources, feedOf, fleetOf, insight, iso, MIN, NOW, parent, PARENT, repo, snapshotOf } from './fixtures'

// The real builder, counted: "nothing changed" means no world was put together, not only
// that none was handed over.
vi.mock('./build', async (original) => {
  const real = await original<typeof import('./build')>()
  return { ...real, buildWorld: vi.fn(real.buildWorld) }
})
const builds = () => vi.mocked(buildWorld).mock.calls.length

const CID = CHILD.slice(0, 8)
const OTHER = 'bbbbbbbb-0000-4000-8000-000000000002'

/** A fleet of two parents and one child, read once: the world the tests start from. */
async function started(children = [child()]) {
  const fake = fakeSources(snapshotOf([repo({ parents: [parent(), parent({ session_id: OTHER, name: 'other' })], children })]))
  const worlds: World[] = []
  const stop = createLive(fake.sources, (w) => worlds.push(w))
  await fake.settle()
  const last = () => worlds[worlds.length - 1]
  return { ...fake, worlds, stop, last }
}

describe('when the live world is handed over', () => {
  test('not before the mission snapshot answered', async () => {
    const fake = fakeSources()
    const worlds: World[] = []
    createLive(fake.sources, (w) => worlds.push(w))
    await fake.run(READ_MS)
    await fake.run(CLOCK_MS)
    expect(worlds).toEqual([])
    expect(fake.state.asked.feed).toEqual([])

    fake.mission.set(snapshotOf([repo()]))
    await fake.settle()
    expect(worlds).toHaveLength(1)
    expect(worlds[0].source).toBe('live')
    expect(worlds[0].sessions.map((s) => s.id)).toEqual([PARENT])
  })

  test('not before the core said what the sessions are doing: a child deep in a long command is never first shown stalled', async () => {
    const fake = fakeSources(snapshotOf([repo({ children: [child({ updated_at: iso(NOW - 40 * MIN) })] })]))
    fake.state.feed.sessions[CID] = feedOf({ activity: { tool: 'Bash', target: 'gh pr checks --watch', at: NOW - 40 * MIN, running: true } })
    const worlds: World[] = []
    createLive(fake.sources, (w) => worlds.push(w))
    expect(worlds).toEqual([])
    await fake.settle()
    expect(worlds.map((w) => sessionOf(w, CHILD)?.state)).toEqual(['working'])
  })

  test('a snapshot that could not be read is a world that says so', async () => {
    const fake = fakeSources()
    const worlds: World[] = []
    createLive(fake.sources, (w) => worlds.push(w))
    fake.missionError.set('claude: program not found')
    await fake.settle()
    expect(worlds).toHaveLength(1)
    expect(worlds[0].sessions).toEqual([])
    expect(worlds[0].errors).toEqual(['The fleet could not be read: claude: program not found'])
  })

  test('stopped while the core is still answering, the answer builds nothing', async () => {
    const live = await started()
    live.state.feed.sessions[PARENT] = feedOf({ said: { text: 'Too late.', at: NOW + 1000 } })
    const reading = live.run(READ_MS)
    live.stop()
    await reading
    expect(live.worlds).toHaveLength(1)
  })

  test('nothing after it was stopped, and nothing is listened to any more', async () => {
    const live = await started()
    expect(live.state.subscribed).toBe(6)
    live.stop()
    expect(live.state.subscribed).toBe(0)
    expect(live.state.ticks.every((t) => t.stopped)).toBe(true)
    const before = live.worlds.length
    live.mission.set(snapshotOf([repo({ parents: [parent({ status: 'busy' })] })], iso(NOW + 3000)))
    live.state.now += CLOCK_MS
    await live.run(CLOCK_MS)
    expect(live.worlds).toHaveLength(before)
  })
})

describe('nothing changed', () => {
  test('a poll that answers the same thing again builds no world', async () => {
    const live = await started()
    expect(live.worlds).toHaveLength(1)
    const built = builds()
    for (let i = 1; i <= 3; i++) {
      live.state.now += READ_MS
      // The snapshot is a new object with a new time, as every poll's is, saying the same thing.
      live.mission.set(snapshotOf([repo({ parents: [parent(), parent({ session_id: OTHER, name: 'other' })], children: [child()] })], iso(live.state.now)))
      live.state.feed = { ...live.state.feed, at: live.state.now }
      await live.run(READ_MS)
    }
    expect(live.worlds).toHaveLength(1)
    expect(builds()).toBe(built)
  })

  test('the clock alone moves the world’s now at most every 30 s, and hands over the same sessions', async () => {
    const live = await started()
    const first = live.last()
    live.state.now += CLOCK_MS - 1000
    await live.run(CLOCK_MS)
    expect(live.worlds).toHaveLength(1)

    live.state.now += 1000
    await live.run(CLOCK_MS)
    expect(live.worlds).toHaveLength(2)
    expect(live.last().at).toBe(NOW + CLOCK_MS)
    expect(live.last().sessions).toBe(first.sessions)
    expect(live.last().pending).toBe(first.pending)
    expect(live.last().events).toBe(first.events)
  })

  test('a store that speaks up with nothing new to say builds no world', async () => {
    const live = await started()
    const built = builds()
    live.mission.set(live.mission.get())
    live.fleet.set(live.fleet.get())
    live.accounts.set({ state: null, usage: {}, error: null })
    live.pulses.set([])
    live.hosted.set([])
    await live.settle()
    expect(live.worlds).toHaveLength(1)
    expect(builds()).toBe(built)
  })
})

describe('something changed', () => {
  test('only the session whose data changed is a new object', async () => {
    const live = await started()
    const before = live.last()
    live.state.feed.sessions[PARENT] = feedOf({ said: { text: 'Pushed the fix.', at: NOW + 1000 }, context: 90_000 })
    live.state.now += READ_MS
    await live.run(READ_MS)

    const after = live.last()
    expect(live.worlds).toHaveLength(2)
    expect(sessionOf(after, PARENT)!.said).toEqual({ at: NOW + 1000, text: 'Pushed the fix.' })
    expect(sessionOf(after, PARENT)).not.toBe(sessionOf(before, PARENT))
    expect(sessionOf(after, OTHER)).toBe(sessionOf(before, OTHER))
    expect(sessionOf(after, CHILD)).toBe(sessionOf(before, CHILD))
    expect(after.accounts).toBe(before.accounts)
    expect(after.vault).toBe(before.vault)
  })

  test('within the session that changed, what did not change is the same object', async () => {
    const live = await started()
    live.state.insights[PARENT] = insight({ turns: 3, activity: [{ at: NOW - MIN, tool: 'Read', kind: 'read', target: 'src/app.ts', running: false, ok: true, ms: 12 }], activityTotal: 1 })
    await live.run(READ_MS)
    const before = sessionOf(live.last(), PARENT)!
    live.state.insights[PARENT] = { ...live.state.insights[PARENT], turns: 4 }
    await live.run(READ_MS)
    const after = sessionOf(live.last(), PARENT)!
    expect(after.turns).toBe(4)
    expect(after).not.toBe(before)
    expect(after.activity).toBe(before.activity)
    expect(after.context).toBe(before.context)
    expect(after.tokens).toBe(before.tokens)
    expect(after.memory).toBe(before.memory)
  })

  test('a hook event moves a session at once, without waiting for a poll', async () => {
    const live = await started()
    expect(sessionOf(live.last(), PARENT)!.state).toBe('idle')
    live.fleet.set(fleetOf({ [PARENT]: { state: 'needs-you', waitingFor: 'permission' } }))
    await live.settle()
    expect(sessionOf(live.last(), PARENT)!.state).toBe('need')
    expect(live.last().pending.map((p) => [p.session, p.kind])).toEqual([[PARENT, 'permission']])
    expect(live.state.asked.feed).toHaveLength(1)
  })

  test('a snapshot and the fleet that reads it, changing in one turn, are one new world', async () => {
    const live = await started()
    live.mission.set(snapshotOf([repo({ parents: [parent({ status: 'busy' }), parent({ session_id: OTHER, name: 'other' })], children: [child()] })]))
    live.fleet.set(fleetOf({ [PARENT]: { state: 'working' } }))
    live.hosted.set([PARENT])
    await live.settle()
    expect(live.worlds).toHaveLength(2)
    expect(sessionOf(live.last(), PARENT)).toMatchObject({ state: 'working', hosted: true })
  })

  test('a child that went quiet becomes stalled as the clock passes 15 minutes, with no new data', async () => {
    const live = await started([child({ updated_at: iso(NOW - 14 * MIN) })])
    expect(sessionOf(live.last(), CHILD)!.state).toBe('idle')
    live.state.now += 2 * MIN
    await live.run(CLOCK_MS)
    expect(sessionOf(live.last(), CHILD)!.state).toBe('stalled')
    expect(live.last().pending.map((p) => p.kind)).toEqual(['stalled'])
    expect(sessionOf(live.last(), OTHER)).toBe(sessionOf(live.worlds[0], OTHER))
  })

  test('a new account, a rule mnemo gave and a plan window reach the world as they arrive', async () => {
    const live = await started()
    live.accounts.set({ state: { active: 'default', accounts: [{ id: 'default', label: 'me', configDir: '', isDefault: true, kind: 'claude', email: null, problem: null, unshared: [] }] }, usage: {}, error: null })
    live.pulses.set([{ at: NOW, kind: 'reflex', project: 'atlas', agent: 'atlas', slugs: ['name-the-flag'], session_id: PARENT }])
    await live.settle()
    expect(live.last().accounts.map((a) => a.label)).toEqual(['me'])
    expect(sessionOf(live.last(), PARENT)!.memory.trail.injected.map((r) => r.slug)).toEqual(['name-the-flag'])
    expect(live.last().vault.recent.map((r) => r.slug)).toEqual(['name-the-flag'])
  })
})

describe('what the core is asked', () => {
  test('the feed and the insight, for every parent and every child mnemo knows the session of', async () => {
    const live = await started([child(), child({ id: 'nosess01', session_id: null })])
    const [asks] = live.state.asked.feed
    expect(asks.map((a) => [a.key, a.sessionId, a.jobId])).toEqual([
      [PARENT, PARENT, null],
      [OTHER, OTHER, null],
      [CID, CHILD, CID],
    ])
    expect(live.state.asked.insight[0].map((a) => a.key)).toEqual([PARENT, OTHER, CID])
    expect(live.state.asked.trails[0]).toEqual([PARENT, OTHER, CHILD])
  })

  test('a child’s pull request is asked about by its address', async () => {
    const url = 'https://github.com/acme/atlas/pull/77'
    const live = await started([child({ pr: { number: 77, url, state: 'OPEN', head: 'fix', ci: 'pending' } })])
    expect(live.state.asked.feed[0].find((a) => a.key === CID)?.prUrl).toBe(url)
  })

  test('an ended session is read once: its transcript will not change, and its answer is kept', async () => {
    const live = await started([child({ live: false, state: 'done' })])
    expect(live.state.asked.insight[0].map((a) => a.key)).toContain(CID)
    live.state.insights[CID] = insight({ title: 'Cursor pagination', turns: 7 })
    await live.run(READ_MS)
    expect(sessionOf(live.last(), CHILD)!.title).toBe('Cursor pagination')

    const asked = live.state.asked.insight.length
    delete live.state.insights[CID]
    await live.run(READ_MS)
    await live.run(READ_MS)
    expect(live.state.asked.insight.slice(asked).flat().map((a) => a.key)).not.toContain(CID)
    expect(sessionOf(live.last(), CHILD)!.title).toBe('Cursor pagination')
    // The live ones are still asked about every time.
    expect(live.state.asked.insight.slice(asked).every((asks) => asks.some((a) => a.key === PARENT))).toBe(true)
  })

  test('one that lives again is read again', async () => {
    const live = await started([child({ live: false, state: 'done' })])
    live.state.insights[CID] = insight({ turns: 7 })
    await live.run(READ_MS)
    live.mission.set(snapshotOf([repo({ parents: [parent(), parent({ session_id: OTHER, name: 'other' })], children: [child({ live: true, state: 'working' })] })]))
    live.state.insights[CID] = insight({ turns: 8 })
    await live.run(READ_MS)
    expect(sessionOf(live.last(), CHILD)!.turns).toBe(8)
  })

  test('a parent that is gone is asked about where its child works', async () => {
    const gone = 'dddddddd-0000-4000-8000-000000000009'
    const live = await started([child({ parent_session: gone, account: 'work' })])
    expect(live.state.asked.insight[0].find((a) => a.key === gone)).toEqual({ key: gone, sessionId: gone, cwd: '/Users/you/code/atlas', account: 'work' })
    expect(live.state.asked.feed[0].map((a) => a.key)).not.toContain(gone)
  })
})

describe('what could not be read', () => {
  test('a core that answers no insight and no trail is said, until it answers', async () => {
    const live = await started()
    expect(live.last().errors).toEqual([
      "Tokens, context and activity are not read yet: this build's core answers no session insight.",
      "Memory shows only what the app heard while it ran: this build's core answers no memory trail.",
    ])
    live.state.insights[PARENT] = insight({ turns: 1 })
    live.state.trails[PARENT] = { prompts: 9, injected: [], considered: [], read: [], briefings: [], frictions: [] }
    await live.run(READ_MS)
    expect(live.last().errors).toEqual([])
    expect(sessionOf(live.last(), PARENT)!.turns).toBe(1)
    expect(sessionOf(live.last(), PARENT)!.memory.trail.prompts).toBe(9)
  })

  test('a feed that fails is said, the world is still there, and the line goes when it answers again', async () => {
    const live = await started()
    live.state.insights[PARENT] = insight()
    live.state.trails[PARENT] = { prompts: 0, injected: [], considered: [], read: [], briefings: [], frictions: [] }
    live.state.feedFails = 'transcript unreadable'
    await live.run(READ_MS)
    expect(live.last().errors).toEqual(['What the sessions are doing could not be read: transcript unreadable'])
    expect(live.last().sessions).toHaveLength(3)
    live.state.feedFails = null
    await live.run(READ_MS)
    expect(live.last().errors).toEqual([])
  })
})
