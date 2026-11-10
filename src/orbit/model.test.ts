import { sampleActions, sampleWorld } from '../world/sample'
import { sessionOf } from '../world/store'
import type { Session, World } from '../world/types'
import { BAND, NAMED, buildScene, doing, familyCounts, findSessions, memoryEvents, nodeFor, pinOrder, readVault } from './model'

const world = sampleWorld()
const titled = (w: World, text: string): Session => {
  const hit = w.sessions.find((s) => s.title.startsWith(text))
  if (!hit) throw new Error(`no session titled ${text}`)
  return hit
}
const bodyTitled = (w: World, text: string) => buildScene(w).bodyOf(titled(w, text).id)!

/** The sample with one session changed. */
const withSession = (text: string, patch: Partial<Session>, base: World = world): World => {
  const id = titled(base, text).id
  return { ...base, sessions: base.sessions.map((s) => (s.id === id ? { ...s, ...patch } : s)) }
}

describe('the bands of attention', () => {
  test('there is one body per root session, and a child is found on its family’s body', () => {
    const scene = buildScene(world)
    expect(scene.bodies.length).toBe(world.sessions.filter((s) => !s.parent).length)
    const child = titled(world, 'Webhook signature check')
    expect(scene.bodyOf(child.id)?.root.title).toMatch(/^Idempotent retries/)
    expect(scene.bodyOf(child.short)?.id).toBe(scene.bodyOf(child.id)?.id)
    expect(scene.bodyOf('nobody')).toBeUndefined()
  })

  test('a family stands in the band of its most pressing member', () => {
    // working itself, but a child asks for a permission
    expect(bodyTitled(world, 'Idempotent retries').band).toBe('need')
    // its turn is over, but a child's merge waits
    expect(bodyTitled(world, 'Optimistic updates').band).toBe('need')
    expect(bodyTitled(world, 'Order status history').band).toBe('need')
    expect(bodyTitled(world, 'Why is the bundle').band).toBe('working')
    expect(bodyTitled(world, 'Dark theme contrast').band).toBe('idle')
    // nothing in the family is alive
    const over = withSession('Notes for the 2.5', { state: 'ended', live: false })
    expect(bodyTitled(over, 'Notes for the 2.5').band).toBe('ended')
  })

  test('a body stands inside its band, and a fresher request stands nearer the centre', () => {
    for (const b of buildScene(world).bodies) {
      expect(b.rho).toBeGreaterThan(BAND[b.band].lo)
      expect(b.rho).toBeLessThan(BAND[b.band].hi)
    }
    const asked6m = bodyTitled(world, 'Idempotent retries')
    const asked14m = bodyTitled(world, 'Order status history')
    const asked75m = bodyTitled(world, 'Optimistic updates')
    expect(asked6m.rho).toBeLessThan(asked14m.rho)
    expect(asked14m.rho).toBeLessThan(asked75m.rho)
  })

  test('a request mnemo gave up asking about waits at the band’s outer edge', () => {
    const gaveUp = bodyTitled(withSession('Order status history', { abandoned: true }), 'Order status history')
    expect(gaveUp.band).toBe('need')
    expect(gaveUp.t).toBe(1)
    expect(gaveUp.rho).toBeGreaterThan(bodyTitled(world, 'Optimistic updates').rho)
  })

  test('a quiet session drifts outward as time passes', () => {
    const now = bodyTitled(world, 'Dark theme contrast')
    const later = bodyTitled({ ...world, at: world.at + 12 * 3_600_000 }, 'Dark theme contrast')
    expect(later.band).toBe('idle')
    expect(later.rho).toBeGreaterThan(now.rho)
  })

  test('an answer moves the family out of "needs you"', async () => {
    const box = { world: sampleWorld() }
    const act = sampleActions(() => box.world, (w) => (box.world = w))
    const before = bodyTitled(box.world, 'Order status history')
    await act.answer(before.pend[0].id, 1)
    const after = bodyTitled(box.world, 'Order status history')
    expect(after.band).toBe('working')
    expect(after.rho).toBeGreaterThan(before.rho)
    expect(after.pend).toEqual([])
  })

  test('what waits in a family is listed with a question before a stall before a merge', () => {
    expect(bodyTitled(world, 'Idempotent retries').pend.map((p) => p.kind)).toEqual(['permission', 'stalled', 'merge'])
  })

  test('a body is larger the more its tree spent', () => {
    const small = bodyTitled(world, 'Notes for the 2.5')
    const large = bodyTitled(world, 'Idempotent retries')
    expect(large.tree).toBeGreaterThan(small.tree)
    expect(large.size).toBeGreaterThan(small.size)
    expect(small.size).toBeGreaterThanOrEqual(0)
    expect(large.size).toBeLessThanOrEqual(1)
  })
})

describe('what the scene has room to name', () => {
  const crowd = (n: number): World => {
    const model = titled(world, 'Notes for the 2.5')
    const more = Array.from({ length: n }, (_, i): Session => ({ ...model, id: `ended-${i}`, short: `ended-${i}`, title: `Ended ${i}`, state: 'ended', live: false, children: [], lastAt: world.at - (i + 1) * 3_600_000, startedAt: world.at - (i + 30) * 3_600_000 }))
    return { ...world, sessions: [...world.sessions, ...more] }
  }

  test('every session that is not over keeps its name; the oldest ended ones fold onto the rim', () => {
    const scene = buildScene(crowd(20))
    expect(scene.bodies.length).toBe(NAMED)
    expect(scene.folded.length).toBe(9 + 20 - NAMED)
    expect(scene.bodies.filter((b) => b.band !== 'ended').length).toBe(9)
    // the ones that kept their name are the ones that ended last
    const named = scene.bodies.filter((b) => b.band === 'ended').map((b) => b.lastAt!)
    for (const f of scene.folded) expect(f.lastAt!).toBeLessThan(Math.min(...named))
    // a folded body is still its session's body
    expect(scene.bodyOf(scene.folded[0].id)?.folded).toBe(true)
  })

  test('nothing folds while there is room', () => {
    expect(buildScene(crowd(5)).folded).toEqual([])
    expect(buildScene(world).folded).toEqual([])
  })
})

describe('the order of the projects', () => {
  test('is the world’s until one is remembered, and a remembered one keeps its place', () => {
    expect(buildScene(world).projects.map((p) => p.name)).toEqual(['atlas-api', 'lumen-web', 'harbor-cli', 'tessera'])
    expect(buildScene(world, { order: ['tessera', 'atlas-api'] }).projects.map((p) => p.name)).toEqual(['tessera', 'atlas-api', 'lumen-web', 'harbor-cli'])
    expect(pinOrder(['a', 'b', 'c'], ['c', 'gone', 'c'])).toEqual(['c', 'gone', 'a', 'b'])
  })

  test('a project’s bodies are in the order they started', () => {
    for (const p of buildScene(world).projects) {
      const started = p.bodies.map((b) => b.root.startedAt ?? 0)
      expect(started).toEqual([...started].sort((a, b) => a - b))
    }
  })

  test('a session with no project still gets a sector', () => {
    const scene = buildScene(withSession('Notes for the 2.5', { project: null }))
    expect(scene.projects.map((p) => p.name)).toContain('–')
  })
})

describe('what a label says', () => {
  test('a working session says the call it is running, as a terminal printed it', () => {
    const s = titled(world, 'Why is the bundle')
    const running = s.activity.filter((a) => a.running).pop() ?? s.activity[s.activity.length - 1]
    expect(doing(s)).toEqual({ text: `${running.tool} ${running.target}`, printed: true })
  })

  test('a quiet one says its own recap, else its last words; an ended one says nothing', () => {
    const s = titled(world, 'Dark theme contrast')
    expect(doing({ ...s, recap: { at: 1, text: '  The recap,\n in its words. ' }, said: { at: 2, text: 'What it said last.' } })).toEqual({ text: 'The recap, in its words.', printed: false })
    expect(doing({ ...s, recap: null, said: { at: 2, text: 'What it said last.' } })?.text).toBe('What it said last.')
    expect(doing({ ...s, recap: null, said: null, detail: null, lastPrompt: null, intent: null })).toBeNull()
    expect(doing({ ...s, state: 'ended' })).toBeNull()
  })

  test('a family is counted by state, most urgent first, the ended left out', () => {
    expect(familyCounts(bodyTitled(world, 'Idempotent retries').kids).map((c) => `${c.n} ${c.word}`)).toEqual(['1 needs you', '1 stalled', '1 ready', '1 working'])
    expect(familyCounts(bodyTitled(world, 'Release 2.4').kids)).toEqual([])
    const two = world.sessions.slice(0, 2).map((s) => ({ ...s, state: 'need' as const }))
    expect(familyCounts(two)[0].word).toBe('need you')
  })
})

describe('memory events', () => {
  test('are what the vault saw and what the fleet recorded, each once, oldest first', () => {
    const events = memoryEvents(world)
    const handed = world.sessions.reduce((n, s) => n + s.memory.trail.injected.length, 0)
    const asked = world.sessions.reduce((n, s) => n + s.memory.trail.read.filter((r) => r.slug).length, 0)
    expect(events.length).toBe(handed + asked)
    expect(new Set(events.map((e) => e.key)).size).toBe(events.length)
    expect(events.map((e) => e.at)).toEqual(events.map((e) => e.at).sort((a, b) => a - b))
    for (const e of events) expect(sessionOf(world, e.session)?.project).toBe(e.project)
  })

  test('take in a rule the vault learned and one only the fleet’s events know of', () => {
    const more: World = {
      ...world,
      vault: { ...world.vault, recent: [...world.vault.recent, { at: world.at - 1000, kind: 'learned', slug: 'new-rule', sessionId: null, project: 'tessera' }] },
      events: [...world.events, { at: world.at - 500, kind: 'rule-injected', session: world.sessions[0].id, text: 'only-in-events' }],
    }
    const tail = memoryEvents(more).slice(-2)
    expect(tail.map((e) => [e.kind, e.slug, e.project])).toEqual([
      ['learned', 'new-rule', 'tessera'],
      ['injected', 'only-in-events', world.sessions[0].project],
    ])
  })

  test('a rule leaves from the same node every time', () => {
    expect(nodeFor('retry-with-idempotency-key', 32)).toBe(nodeFor('retry-with-idempotency-key', 32))
    const nodes = ['a', 'b', 'c', 'd', 'e', 'f'].map((slug) => nodeFor(slug, 32))
    for (const n of nodes) expect(n >= 0 && n < 32).toBe(true)
    expect(new Set(nodes).size).toBeGreaterThan(1)
    expect(nodeFor('anything', 0)).toBe(0)
  })
})

describe('the centre, opened', () => {
  const v = readVault(world)

  test('says how often mnemo spoke and how often it stayed silent', () => {
    expect(v.rules).toBe(4160)
    expect(v.spoke).toBe(219)
    expect(v.silent).toBe(660 + 68 + 43 + 21 + 15 + 12)
    expect(v.prompts).toBe(1039)
    expect(v.spokePercent).toBe(21)
    expect(v.outcomes[0]).toEqual({ key: 'emitted', words: 'spoke: a rule was handed over', n: 219, spoke: true })
    expect(v.outcomes.slice(1).map((o) => o.n)).toEqual([660, 68, 43, 21, 15, 12])
    expect(v.outcomes.find((o) => o.key === 'judge_none_relevant')?.words).toBe('the judge found none relevant')
  })

  test('an outcome it has no words for is said as it is named', () => {
    expect(readVault({ ...world, vault: { ...world.vault, outcomes: { emitted: 1, some_new_reason: 3 } } }).outcomes[1].words).toBe('some new reason')
    expect(readVault({ ...world, vault: { ...world.vault, prompts: 0, outcomes: {} } }).spokePercent).toBe(0)
  })

  test('says where memory went and which rules it reached for most', () => {
    const events = memoryEvents(world)
    expect(v.byProject.reduce((n, p) => n + p.n, 0)).toBe(events.length)
    expect(v.byProject.map((p) => p.n)).toEqual([...v.byProject.map((p) => p.n)].sort((a, b) => b - a))
    expect(v.handed).toBe(events.filter((e) => e.kind === 'injected').length)
    expect(v.top.length).toBeLessThanOrEqual(8)
    expect(v.top.map((u) => u.n)).toEqual([...v.top.map((u) => u.n)].sort((a, b) => b - a))
    const first = v.top[0]
    expect(first.n).toBe(events.filter((e) => e.kind === 'injected' && e.slug === first.slug).length)
    expect(first.last.at).toBe(Math.max(...events.filter((e) => e.kind === 'injected' && e.slug === first.slug).map((e) => e.at)))
    expect(v.corrections).toBe(world.sessions.reduce((n, s) => n + s.memory.trail.frictions.length, 0))
  })
})

describe('finding a session', () => {
  const titles = (q: string) => findSessions(world, q).map((s) => s.title)

  test('a title that starts with the text comes before one that only contains it', () => {
    expect(titles('order')[0]).toBe('Order status history column')
    expect(titles('order').slice(1)).toEqual(['Cursor pagination for /orders', 'Empty state for the orders table', 'Optimistic updates on the orders screen'])
    // even when the ones that only contain it are more urgent
    expect(titles('o').slice(0, 2)).toEqual(['Order status history column', 'Optimistic updates on the orders screen'])
    expect(titles('o').length).toBeGreaterThan(4)
  })

  test('a project, a branch or an id finds it too, children included', () => {
    expect(titles('tessera').sort()).toEqual(['Design the plugin manifest format', 'Flaky snapshot test on Windows'])
    const child = titled(world, 'Tenant in every cache key')
    expect(findSessions(world, child.short)).toEqual([child])
    expect(findSessions(world, child.branch!)).toContain(child)
  })

  test('every word must be there, and nothing is found for nothing', () => {
    expect(titles('orders lumen')).toEqual(['Empty state for the orders table', 'Optimistic updates on the orders screen'])
    expect(titles('orders zebra')).toEqual([])
    expect(titles('   ')).toEqual([])
  })
})
