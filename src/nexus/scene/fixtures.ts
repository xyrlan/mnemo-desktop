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
