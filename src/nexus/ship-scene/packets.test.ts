import type { Pulse } from '../../pulse/store'
import type { PulseEvent, PulseKind } from '../../pulse/types'
import { COALESCE_MS, GUARD_MS, ICONS, launch, LEG_MS, MAX_FLYING, packetOf, rulesOf, sessionOf, type Packet, type Session } from './packets'

const ev = (kind: PulseKind, over: Partial<PulseEvent> = {}): PulseEvent => ({ at: 0, kind, project: 'demo', agent: 'demo', slugs: [], ...over })
let id = 1
const pulse = (kind: PulseKind, over: Partial<PulseEvent> = {}): Pulse => ({ id: id++, event: ev(kind, over), received: 0 })

const SESSIONS: Session[] = [
  { sessionId: 's-parent', cwd: '/home/dev/demo' },
  { sessionId: 's-child', cwd: '/home/dev/demo-wt-3' },
  { sessionId: 's-nested', cwd: '/home/dev/demo/.claude/worktrees/a' },
]

test('each kind maps to its packet: icon, legs, direction and what landing does', () => {
  const shape = (k: PulseKind) => {
    const p = packetOf(k)
    return p && { icons: p.icons.join(' '), legs: p.legs.join(' '), dir: p.dir, landing: p.landing }
  }
  expect(shape('reflex')).toEqual({ icons: 'reflex', legs: 'out', dir: 'out', landing: 'rules' })
  expect(shape('catchup')).toEqual({ icons: 'catchup', legs: 'out', dir: 'out', landing: 'rules' })
  // An MCP read goes asking (?) and comes back with what it read (◈).
  expect(shape('tool')).toEqual({ icons: 'tool reflex', legs: 'in out', dir: 'out', landing: 'rules' })
  // enrichment-log.jsonl is rules attached to an Edit/Write: archive → agent, not the agent writing.
  expect(shape('enrich')).toEqual({ icons: 'enrich', legs: 'out', dir: 'out', landing: 'rules' })
  expect(shape('friction')).toEqual({ icons: 'friction', legs: 'in', dir: 'in', landing: 'glow' })
  expect(shape('briefing')).toEqual({ icons: 'briefing', legs: 'in', dir: 'in', landing: 'glow' })
  expect(shape('enforce')).toEqual({ icons: 'enforce', legs: 'out', dir: 'guard', landing: 'shake' })
  expect(shape('learned')).toBeNull()
  expect(shape('dispatch')).toBeNull()
  expect(packetOf('enforce')!.ms).toBe(GUARD_MS)
  expect(GUARD_MS).toBeLessThan(LEG_MS)
})

test('every icon is a 10×10 map in the two palette colours', () => {
  for (const [name, rows] of Object.entries(ICONS)) {
    expect(rows, name).toHaveLength(10)
    for (const r of rows) expect(r, name).toMatch(/^[.#o]{10}$/)
  }
})

test('an event flies to its own session when that figure is on the ship, else nowhere', () => {
  expect(sessionOf(ev('reflex', { session_id: 's-child' }), SESSIONS)).toBe('s-child')
  expect(sessionOf(ev('reflex', { session_id: 's-gone' }), SESSIONS)).toBeNull()
  expect(sessionOf(ev('reflex'), SESSIONS)).toBeNull()
  expect(sessionOf(ev('friction'), SESSIONS)).toBeNull()
})

test('an enrichment names no session: the worktree holding its file does, the deepest one', () => {
  expect(sessionOf(ev('enrich', { file_path: '/home/dev/demo-wt-3/src/a.ts' }), SESSIONS)).toBe('s-child')
  expect(sessionOf(ev('enrich', { file_path: '/home/dev/demo/src/a.ts' }), SESSIONS)).toBe('s-parent')
  expect(sessionOf(ev('enrich', { file_path: '/home/dev/demo/.claude/worktrees/a/x.ts' }), SESSIONS)).toBe('s-nested')
  expect(sessionOf(ev('enrich', { file_path: 'C:\\dev\\other\\a.ts' }), SESSIONS)).toBeNull()
  expect(sessionOf(ev('enrich'), SESSIONS)).toBeNull()
  // Only an enrichment is placed by its file.
  expect(sessionOf(ev('reflex', { file_path: '/home/dev/demo-wt-3/a.ts' }), SESSIONS)).toBeNull()
})

test('a figure counts each rule it got once: reflexes, the boot briefing, enrichments and MCP reads', () => {
  const got = rulesOf(
    [
      pulse('reflex', { session_id: 's-child', slugs: ['a', 'b'] }),
      pulse('reflex', { session_id: 's-child', slugs: ['a'] }),
      pulse('tool', { session_id: 's-child', slugs: ['c'] }),
      pulse('enrich', { file_path: '/home/dev/demo-wt-3/x.ts', slugs: ['d'] }),
      pulse('enforce', { session_id: 's-child', slugs: ['blocked'] }),
      pulse('friction', { session_id: 's-child' }),
      pulse('reflex', { session_id: 's-parent', slugs: ['z'] }),
      pulse('reflex', { session_id: 's-gone', slugs: ['q'] }),
    ],
    SESSIONS,
  )
  expect(Object.fromEntries(got)).toEqual({ 's-child': ['a', 'b', 'c', 'd'], 's-parent': ['z'] })
})

test('Q23: events for one figure within 5 s join the packet in flight, ×N, their rules merged', () => {
  const first = launch([], pulse('reflex', { session_id: 's-child', slugs: ['a'] }), 's-child', 1, 1_000)!
  expect(first.joined).toBe(false)
  const second = launch(first.flying, pulse('reflex', { session_id: 's-child', slugs: ['a', 'b'] }), 's-child', 2, 1_000 + COALESCE_MS - 1)!
  expect(second.joined).toBe(true)
  expect(second.flying).toHaveLength(1)
  expect(second.packet).toMatchObject({ id: 1, n: 2, slugs: ['a', 'b'] })
  expect(second.packet.pulses).toHaveLength(2)
  // Too late, another figure, another kind: a packet of its own.
  expect(launch(second.flying, pulse('reflex', { session_id: 's-child' }), 's-child', 3, 1_000 + COALESCE_MS)!.joined).toBe(false)
  expect(launch(second.flying, pulse('reflex', { session_id: 's-parent' }), 's-parent', 3, 1_500)!.joined).toBe(false)
  expect(launch(second.flying, pulse('enforce', { session_id: 's-child' }), 's-child', 3, 1_500)!.joined).toBe(false)
})

test('past the cap the oldest packets are dropped; a kind that flies nothing launches nothing', () => {
  let flying: Packet[] = []
  const dropped: number[] = []
  for (let i = 1; i <= MAX_FLYING + 2; i++) {
    const l = launch(flying, pulse('friction', { session_id: `s-${i}` }), `s-${i}`, i, 0)!
    flying = l.flying
    dropped.push(...l.dropped.map((p) => p.id))
  }
  expect(flying).toHaveLength(MAX_FLYING)
  expect(dropped).toEqual([1, 2])
  expect(flying[0].id).toBe(3)
  expect(launch(flying, pulse('learned'), 's-1', 99, 0)).toBeNull()
})
