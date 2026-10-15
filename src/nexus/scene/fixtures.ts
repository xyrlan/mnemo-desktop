/** Synthetic worlds for the scene's tests: no real session, repo or transcript. */
import type { ChildSession, ParentSession } from '../../mission/types'
import type { Nexus, Robot, Territory, World } from '../types'

export function child(id: string): ChildSession {
  return {
    id,
    session_id: `s-${id}`,
    name: null,
    state: 'running',
    tempo: 'active',
    needs: null,
    detail: '',
    suggested_reply: null,
    cwd: `/home/dev/mnemo-desktop-wt-${id}`,
    tokens: 0,
    live: true,
    updated_at: null,
    intent: null,
    branch: null,
    timeline_len: 0,
    account: 'default',
  }
}

export function robot(id: string, over: Partial<Robot> = {}): Robot {
  return {
    id,
    sessionId: `s-${id}`,
    label: `#${id}`,
    klass: 'droid',
    level: 0,
    accessory: 0,
    pose: 'idle',
    halo: null,
    badge: null,
    exit: null,
    tool: null,
    child: child(id),
    ...over,
  }
}

export function parent(sessionId: string): ParentSession {
  return { session_id: sessionId, pid: 1, name: null, status: 'idle', cwd: '/home/dev/mnemo-desktop' }
}

export function nexus(sessionId: string, robots: Robot[] = [], over: Partial<Nexus> = {}): Nexus {
  return { sessionId, label: sessionId.slice(0, 8), cwd: '/home/dev/mnemo-desktop', pose: 'idle', halo: null, robots, parent: parent(sessionId), ...over }
}

export function territory(name: string, nexuses: Nexus[], pages = 40): Territory {
  return { root: `/home/dev/${name}`, name, archive: { project: name, pages, tier: pages > 100 ? 2 : pages > 30 ? 1 : 0 }, nexuses }
}

export function world(territories: Territory[], at = 1_000_000): World {
  return { territories, universal: { pages: 120, tier: 2 }, at }
}

/** `n` robots `r0`…, each with a fresh id under `prefix`. */
export const robots = (n: number, prefix = 'r', over: Partial<Robot> = {}): Robot[] => Array.from({ length: n }, (_, i) => robot(`${prefix}${i}`, over))

/** A typical fleet on the spec's 2026-10-14 numbers ("Facts"): 7 territories, 12 live nexuses and 15
 *  live robots in all, 3 to each of the 5 parents that have any. */
export const typicalFleet = (): World =>
  world([
    territory('atlas', [nexus('a1f0c2d9', robots(3, 'a')), nexus('a2b7e410'), nexus('a3c8d521')]),
    territory('beacon-tools', [nexus('b1d2e3f4', robots(3, 'b')), nexus('b2e3f405')]),
    territory('cinder', [nexus('c1e2f3a4', robots(3, 'c')), nexus('c2f3a4b5')]),
    territory('drift', [nexus('d1a2b3c4', robots(3, 'd')), nexus('d2b3c4d5')]),
    territory('ember', [nexus('e1b2c3d4', robots(3, 'e'))]),
    territory('fable-docs', [nexus('f1c2d3e4')]),
    territory('grove', [nexus('g1d2e3f4')]),
  ])
