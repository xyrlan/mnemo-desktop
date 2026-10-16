/** Synthetic ships for the scene's tests: no real session, repo or transcript. */
import type { ChildSession, Mission, Pr } from '../../mission/types'
import type { Captain, Deck, Dock, Ship, ShipRobot } from '../ship-types'

export const ROOT = '/home/dev/mnemo-desktop'

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
    cwd: `${ROOT}-wt-${id}`,
    tokens: 0,
    live: true,
    updated_at: null,
    intent: null,
    branch: null,
    timeline_len: 0,
    account: 'default',
  }
}

export function pr(number: number, over: Partial<Pr> = {}): Pr {
  return { number, url: `https://github.com/example/mnemo-desktop/pull/${number}`, state: 'OPEN', head: `fix/${number}`, ci: 'pass', ...over }
}

export function robot(id: string, over: Partial<ShipRobot> = {}): ShipRobot {
  return {
    id,
    sessionId: `s-${id}`,
    child: child(id),
    captainId: 'cap-1',
    label: `#${id}`,
    via: null,
    klass: 'droid',
    accessory: 0,
    state: 'working',
    zone: 'flight',
    action: 'edit',
    ci: null,
    pr: null,
    fate: null,
    line: `working on ${id}`,
    act: 'Edit · src/a.ts',
    idleMs: 0,
    context: 42_000,
    model: 'claude-opus-4-1',
    contract: null,
    twin: null,
    need: null,
    injected: [],
    ...over,
  }
}

export function captain(id: string, over: Partial<Captain> = {}): Captain {
  return {
    id,
    parent: { session_id: id, pid: 1, name: id, status: 'busy', cwd: ROOT },
    name: `mnemo-${id}`,
    emblem: '◆',
    pose: 'busy',
    topic: 'tidy the docs',
    action: 'Bash · pnpm test',
    notices: 0,
    idleMs: null,
    ...over,
  }
}

export function deck(over: Partial<Deck> = {}): Deck {
  return { root: ROOT, name: 'mnemo-desktop', captains: [captain('cap-1')], quiet: [], flight: [], hangar: [], stranded: [], hangarReady: false, ...over }
}

export function ship(over: Partial<Ship> = {}): Ship {
  return { bridge: { exceptions: [], blocked: [] }, decks: [], docks: [], counts: { working: 0, need: 0, ready: 0 }, rate: null, at: 5_000_000, ...over }
}

export function dock(name: string, captains: Captain[]): Dock {
  return { root: `/home/dev/${name}`, name, captains }
}

export function mission(feature: string, greens: number, total: number): Mission {
  return {
    feature,
    contract_path: `docs/contracts/${feature}.md`,
    landable: true,
    pieces: Array.from({ length: total }, (_, i) => ({ name: `p${i}`, branch: `feat/${feature}/p${i}`, child: null, pr: pr(500 + i, { ci: i < greens ? 'pass' : 'pending' }) })),
  }
}
