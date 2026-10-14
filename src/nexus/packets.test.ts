import { describe, expect, test } from 'vitest'
import type { ChildSession } from '../mission/types'
import type { PulseEvent } from '../pulse/types'
import { COALESCE_MS, PACKET_TTL_MS, injectedRules, packetsFrom } from './packets'
import type { Nexus, Robot, Territory, World } from './types'

const ROOT = '/home/dev/github/mnemo-desktop'
const T0 = 1_760_000_000_000 // a multiple of COALESCE_MS

function robot(id: string, sessionId: string | null, cwd: string): Robot {
  const child = { id, session_id: sessionId, cwd } as ChildSession
  return { id, sessionId, label: id, klass: 'droid', level: 0, accessory: 0, pose: 'working', halo: 'working', badge: null, exit: null, tool: null, child }
}

function nexus(sessionId: string, robots: Robot[]): Nexus {
  return { sessionId, label: sessionId, cwd: ROOT, pose: 'busy', halo: 'working', robots, parent: null }
}

function territory(root: string, project: string, nexuses: Nexus[]): Territory {
  return { root, name: project, archive: { project, pages: 10, tier: 0 }, nexuses }
}

const WORLD: World = {
  territories: [
    territory(ROOT, 'mnemo-desktop', [nexus('parent-1', [robot('job-a', 'child-a', `${ROOT}-wt-41`), robot('job-b', 'child-b', `${ROOT}-wt-42`)])]),
    territory('/home/dev/github/mnemo', 'mnemo', [nexus('parent-2', [])]),
  ],
  universal: { pages: 3, tier: 0 },
  at: T0,
}

const ev = (kind: PulseEvent['kind'], at: number, more: Partial<PulseEvent> & { file_path?: string } = {}): PulseEvent => ({
  at,
  kind,
  project: 'mnemo-desktop',
  agent: 'mnemo-desktop',
  slugs: [],
  ...more,
})

describe('packetsFrom', () => {
  test('each event kind takes its Q22 path to the agent its session names', () => {
    const events = [
      ev('catchup', T0, { session_id: 'child-a', slugs: ['boot'] }),
      ev('reflex', T0, { session_id: 'child-a', slugs: ['r1'] }),
      ev('tool', T0, { session_id: 'parent-1', tool: 'list_rules_by_topic' }),
      ev('friction', T0, { session_id: 'child-b' }),
      ev('briefing', T0, { session_id: 'parent-2', project: 'mnemo' }),
    ]
    const got = packetsFrom(events, WORLD, T0).map((p) => [p.kind, p.path, p.agent, p.root])
    expect(got).toEqual([
      ['briefing', 'to-archive', { kind: 'nexus', id: 'parent-2' }, '/home/dev/github/mnemo'],
      ['catchup', 'to-agent', { kind: 'robot', id: 'job-a' }, ROOT],
      ['friction', 'to-archive', { kind: 'robot', id: 'job-b' }, ROOT],
      ['read', 'round-trip', { kind: 'nexus', id: 'parent-1' }, ROOT],
      ['reflex', 'to-agent', { kind: 'robot', id: 'job-a' }, ROOT],
    ])
  })

  test('an event no agent can be named for flashes its project archive', () => {
    const events = [
      ev('reflex', T0, { session_id: 'someone-else', slugs: ['x'] }),
      ev('friction', T0 + 1),
      ev('learned', T0 + 2, { project: 'mnemo', session_id: 'parent-2', slugs: ['new-rule'] }),
    ]
    const got = packetsFrom(events, WORLD, T0)
    expect(got.map((p) => [p.kind, p.path, p.agent, p.root])).toEqual([
      ['reflex', 'flash', null, ROOT],
      ['friction', 'flash', null, ROOT],
      ['learned', 'flash', null, '/home/dev/github/mnemo'],
    ])
  })

  test('a project with no territory, enforce and dispatch draw nothing', () => {
    const events = [ev('reflex', T0, { project: 'elsewhere', slugs: ['x'] }), ev('enforce', T0, { session_id: 'child-a', slugs: ['x'] }), ev('dispatch', T0, { session_id: 'parent-1' })]
    expect(packetsFrom(events, WORLD, T0)).toEqual([])
  })

  test('an enrich goes to the robot whose worktree holds its file, else flashes', () => {
    const events = [
      ev('enrich', T0, { file_path: `${ROOT}-wt-42/src/a.ts`, slugs: ['e1'] }),
      // The parent's own checkout names no robot.
      ev('enrich', T0 + 1, { file_path: `${ROOT}/src/b.ts`, slugs: ['e2'] }),
      // `-wt-4` is not `-wt-42`'s parent: paths compare as paths.
      ev('enrich', T0 + 2, { file_path: `${ROOT}-wt-4/x.ts`, slugs: ['e3'] }),
      // What the pulse sends today: no file.
      ev('enrich', T0 + 3, { slugs: ['e4'] }),
    ]
    const got = packetsFrom(events, WORLD, T0)
    expect(got.map((p) => [p.path, p.agent, p.slugs])).toEqual([
      ['to-agent', { kind: 'robot', id: 'job-b' }, ['e1']],
      ['flash', null, ['e2', 'e3', 'e4']],
    ])
  })

  test('an enrich file in a Windows worktree matches however it is spelt', () => {
    const win: World = { ...WORLD, territories: [territory('C:/dev/repo', 'repo', [nexus('p', [robot('job-w', null, 'C:\\dev\\repo-wt-7')])])] }
    const got = packetsFrom([ev('enrich', T0, { project: 'repo', file_path: 'c:/dev/repo-wt-7/src/a.ts' })], win, T0)
    expect(got.map((p) => p.agent)).toEqual([{ kind: 'robot', id: 'job-w' }])
  })

  test('events for one agent within a window coalesce, slugs unioned, into one packet', () => {
    const events = [
      ev('reflex', T0 + 100, { session_id: 'child-a', slugs: ['a', 'b'] }),
      ev('reflex', T0 + 2_000, { session_id: 'child-a', slugs: ['b', 'c'] }),
      ev('reflex', T0 + 4_900, { session_id: 'child-a', slugs: ['d'] }),
      // Another agent, and another kind for the same agent, stay their own packets.
      ev('reflex', T0 + 200, { session_id: 'child-b', slugs: ['z'] }),
      ev('tool', T0 + 300, { session_id: 'child-a' }),
      // The next window.
      ev('reflex', T0 + COALESCE_MS + 1, { session_id: 'child-a', slugs: ['e'] }),
    ]
    const got = packetsFrom(events, WORLD, T0 + COALESCE_MS)
    expect(got.map((p) => [p.kind, p.agent?.id, p.count, p.slugs, p.at])).toEqual([
      ['reflex', 'job-a', 3, ['a', 'b', 'c', 'd'], T0 + 100],
      ['reflex', 'job-b', 1, ['z'], T0 + 200],
      ['read', 'job-a', 1, [], T0 + 300],
      ['reflex', 'job-a', 1, ['e'], T0 + COALESCE_MS + 1],
    ])
  })

  test('a packet keeps its id across calls, as events arrive and old ones leave the log', () => {
    const first = ev('reflex', T0 + 1_000, { session_id: 'child-a', slugs: ['a'] })
    const older = ev('briefing', T0 - 20_000, { session_id: 'parent-1' })
    const before = packetsFrom([older, first], WORLD, T0 + 1_000)
    const after = packetsFrom([first, ev('reflex', T0 + 3_000, { session_id: 'child-a', slugs: ['b'] })], WORLD, T0 + 3_000)
    const reflex = (ps: ReturnType<typeof packetsFrom>) => ps.find((p) => p.kind === 'reflex')!
    expect(reflex(after).id).toBe(reflex(before).id)
    expect(reflex(after).count).toBe(2)
    // Two calls on the same input give the same packets.
    expect(packetsFrom([older, first], WORLD, T0 + 1_000)).toEqual(before)
    expect(new Set(before.map((p) => p.id)).size).toBe(before.length)
  })

  test('packets whose newest event is past the TTL are left out', () => {
    const events = [ev('reflex', T0, { session_id: 'child-a', slugs: ['a'] }), ev('reflex', T0 + COALESCE_MS, { session_id: 'child-b', slugs: ['b'] })]
    expect(packetsFrom(events, WORLD, T0 + PACKET_TTL_MS).map((p) => p.agent?.id)).toEqual(['job-a', 'job-b'])
    expect(packetsFrom(events, WORLD, T0 + PACKET_TTL_MS + 1).map((p) => p.agent?.id)).toEqual(['job-b'])
  })

  test('an empty world draws nothing', () => {
    expect(packetsFrom([ev('reflex', T0, { slugs: ['a'] })], { territories: [], universal: { pages: 0, tier: 0 }, at: T0 }, T0)).toEqual([])
  })
})

describe('injectedRules', () => {
  test('the slugs put in front of one session, newest first, without repeats', () => {
    const events = [
      ev('catchup', T0, { session_id: 'child-a', slugs: ['boot-1', 'boot-2'] }),
      ev('reflex', T0 + 10, { session_id: 'child-a', slugs: ['r1', 'boot-1'] }),
      ev('reflex', T0 + 20, { session_id: 'child-b', slugs: ['not-mine'] }),
      // What the agent searched for was not injected.
      ev('tool', T0 + 30, { session_id: 'child-a', slugs: ['searched'] }),
      ev('reflex', T0 + 40, { session_id: 'child-a', slugs: ['r2'] }),
      ev('reflex', T0 + 50, { slugs: ['no-session'] }),
    ]
    expect(injectedRules(events, 'child-a')).toEqual(['r2', 'r1', 'boot-1', 'boot-2'])
    expect(injectedRules(events, 'nobody')).toEqual([])
  })

  test('of two events at one time, the one logged later is newer', () => {
    const events = [ev('reflex', T0, { session_id: 's', slugs: ['first'] }), ev('reflex', T0, { session_id: 's', slugs: ['second'] })]
    expect(injectedRules(events, 's')).toEqual(['second', 'first'])
  })
})
