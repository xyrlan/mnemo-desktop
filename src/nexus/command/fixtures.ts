import type { ChildSession, Mission, ParentSession, Pr } from '../../mission/types'
import { orphanCaptainId, type Captain, type Deck, type PrFate, type Ship, type ShipRobot } from '../ship-types'

/** A synthetic ship for the command piece's tests: no real session, transcript or private repo. */

export const ROOT = '/Users/you/github/mnemo-desktop'
export const MNEMO = '/Users/you/github/mnemo'

export function child(id: string, over: Partial<ChildSession> = {}): ChildSession {
  return {
    id,
    session_id: `${id}-0000-4000-8000-000000000000`,
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
    intent: `Work on issue in this repo (${id})`,
    branch: `fix/${id}`,
    timeline_len: 6,
    account: 'default',
    ...over,
  }
}

export const pr = (number: number, over: Partial<Pr> = {}): Pr => ({ number, url: `https://github.com/you/mnemo-desktop/pull/${number}`, state: 'OPEN', head: `fix/${number}`, ci: 'pass', ...over })
const open: PrFate = { state: 'OPEN', mergedAt: null, closedAt: null, checks: [{ name: 'test', startedAt: 500, completedAt: 900, conclusion: 'SUCCESS' }] }

export function robot(id: string, over: Partial<ShipRobot> = {}): ShipRobot {
  return {
    id,
    sessionId: `${id}-0000-4000-8000-000000000000`,
    child: child(id),
    captainId: 'cap-1-0000-4000-8000-000000000000',
    label: `#${id}`,
    via: null,
    klass: 'mech',
    accessory: 0,
    state: 'working',
    zone: 'flight',
    action: 'edit',
    ci: null,
    pr: null,
    fate: null,
    line: 'writing the fix',
    act: 'Edit src/x.ts',
    idleMs: 0,
    context: null,
    model: null,
    contract: null,
    twin: null,
    need: null,
    injected: [],
    ...over,
  }
}

export const parent = (session_id: string, over: Partial<ParentSession> = {}): ParentSession => ({ session_id, pid: 1, name: null, status: 'idle', cwd: ROOT, ...over })

export function captain(id: string, name: string, over: Partial<Captain> = {}): Captain {
  return { id, parent: parent(id), name, emblem: '◆', pose: 'idle', topic: null, action: null, notices: 0, idleMs: null, ...over }
}

export const mission = (feature: string, over: Partial<Mission> = {}): Mission => ({ feature, contract_path: `docs/superpowers/contracts/2026-10-15-${feature}.md`, pieces: [], landable: true, ...over })

/** A ship with one deck (mnemo-desktop) and one dock (mnemo):
 *  - `#101` blocked on a question, `#102` on a permission (both on the bridge);
 *  - `#103` working, `#104·a` and `#104·b` twins idle, `feed` a contract piece working;
 *  - `#105` and `#106` in the hangar, green and red; `#107` stranded;
 *  - a `nexus-v2` mission landable. */
export function ship(): Ship {
  const lead = captain('cap-1-0000-4000-8000-000000000000', 'fleet lead')
  const other = captain('cap-2-0000-4000-8000-000000000000', 'reviewer', { emblem: '●' })
  const q = robot('101', { state: 'need', zone: 'bridge', action: null, need: { kind: 'question', text: 'Which way?', options: ['Keep it', 'Drop it'] } })
  const p = robot('102', { state: 'need', zone: 'bridge', action: null, need: { kind: 'permission', text: 'Bash: rm -rf build', options: ['yes', 'always', 'no'] } })
  const deck: Deck = {
    root: ROOT,
    name: 'mnemo-desktop',
    captains: [lead],
    quiet: [other],
    flight: [
      robot('103'),
      robot('104a', { label: '#104·a', twin: 'a', state: 'idle', action: null }),
      robot('104b', { label: '#104·b', twin: 'b', state: 'idle', action: null }),
      robot('feed1', { label: 'feed', contract: { feature: 'nexus-v2', piece: 'feed', consumes: [] } }),
    ],
    hangar: [
      robot('105', { state: 'done', zone: 'hangar', action: null, ci: 'green', pr: pr(205), fate: open }),
      robot('106', { state: 'done', zone: 'hangar', action: null, ci: 'red', pr: pr(206, { ci: 'fail' }), fate: open }),
    ],
    stranded: [robot('107', { state: 'idle', zone: 'stranded', action: null, idleMs: 20 * 60_000, captainId: orphanCaptainId(ROOT) })],
    hangarReady: true,
  }
  const m = mission('nexus-v2')
  return {
    bridge: {
      exceptions: [
        { kind: 'need', robotId: '101', need: q.need! },
        { kind: 'need', robotId: '102', need: p.need! },
        { kind: 'red', robotId: '106', pr: pr(206) },
        { kind: 'land', root: ROOT, mission: m },
        { kind: 'ready', robotId: '105', pr: pr(205), waitingMs: 60_000 },
        { kind: 'stranded', robotId: '107', idleMs: 20 * 60_000 },
      ],
      blocked: [q, p],
    },
    decks: [deck],
    docks: [{ root: MNEMO, name: 'mnemo', captains: [captain('cap-3-0000-4000-8000-000000000000', 'mnemo main', { emblem: '▲' })] }],
    counts: { working: 2, need: 2, ready: 1 },
    rate: null,
    at: 1_000,
  }
}
