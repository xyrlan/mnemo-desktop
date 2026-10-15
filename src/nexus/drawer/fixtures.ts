import type { RepoNode } from '../../fleet/types'
import type { PaneId, PtyClient } from '../../pty/client'
import { createSessionHost } from '../../session/host'
import { child, parent } from '../interact-fixtures'
import type { Captain, Ship, ShipRobot } from '../ship-types'

/** Synthetic ships for the drawer's tests: no real session, path or log. */

export const robotOf = (over: Partial<ShipRobot> = {}): ShipRobot => {
  const c = over.child ?? child()
  return {
    id: c.id,
    sessionId: c.session_id,
    child: c,
    captainId: 'cap-1',
    label: '#682',
    via: null,
    klass: 'mech',
    accessory: 0,
    state: 'working',
    zone: 'flight',
    action: 'edit',
    ci: null,
    pr: null,
    fate: null,
    line: 'wiring the drawer',
    act: null,
    idleMs: 0,
    context: 182_000,
    model: null,
    contract: null,
    twin: 'a',
    need: null,
    injected: [],
    ...over,
  }
}

export const captainOf = (over: Partial<Captain> = {}): Captain => ({
  id: 'cap-1',
  parent: parent({ session_id: 'cap-1', cwd: '/work/mnemo-desktop' }),
  name: 'nexus round',
  emblem: '◆',
  pose: 'busy',
  topic: 'build the drawer',
  action: null,
  notices: 0,
  ...over,
})

/** A ship of one deck, `mnemo-desktop`: captain `cap-1` (in pane 7), captain `cap-2` alive outside
 *  the app, captain `cap-3` ended; robot `r-live` (live, in no pane), `r-pane` (in pane 9) and
 *  `r-done` (ended). A dock `mnemo` holds the empty chair `orphan:/work/mnemo`. */
export function shipFixture(): Ship {
  const live = robotOf({ child: child({ id: 'r-live', session_id: 's-live', cwd: '/work/mnemo-desktop-wt-682/src' }) })
  const inPane = robotOf({ child: child({ id: 'r-pane', session_id: 's-pane' }), label: '#404', twin: null })
  const done = robotOf({ child: child({ id: 'r-done', session_id: 's-done', live: false }), label: '#401', twin: null, state: 'done', zone: 'hangar' })
  return {
    bridge: { exceptions: [{ kind: 'stranded', robotId: 'r-live', idleMs: 1 }], blocked: [] },
    decks: [
      {
        root: '/work/mnemo-desktop',
        name: 'mnemo-desktop',
        captains: [captainOf(), captainOf({ id: 'cap-2', parent: parent({ session_id: 'cap-2' }), name: 'triage', emblem: '●', pose: 'idle' })],
        quiet: [captainOf({ id: 'cap-3', parent: parent({ session_id: 'cap-3', status: 'ended' }), name: 'old round', emblem: '▲', pose: 'offline' })],
        flight: [live, inPane],
        hangar: [done],
        stranded: [],
        hangarReady: false,
      },
    ],
    docks: [{ root: '/work/mnemo', name: 'mnemo', captains: [captainOf({ id: 'orphan:/work/mnemo', parent: null, name: 'no captain', emblem: '?', pose: 'empty' })] }],
    counts: { working: 2, need: 0, ready: 0 },
    rate: null,
    at: 1,
  }
}

/** The fleet: captain `cap-1` runs in pane 7, robot `r-pane`'s session in pane 9. */
export const reposFixture: RepoNode[] = [
  {
    root: '/work/mnemo-desktop',
    name: 'mnemo-desktop',
    worktrees: [
      {
        path: '/work/mnemo-desktop',
        name: 'mnemo-desktop',
        branch: 'main',
        kind: 'main',
        pr: null,
        unread: false,
        agents: [
          { sessionId: 'cap-1', paneId: 7, state: 'working', waitingFor: null, title: 'nexus round', since: 0 },
          { sessionId: 's-pane', paneId: 9, state: 'working', waitingFor: null, title: 'attach', since: 0 },
          { sessionId: 'cap-2', paneId: null, state: 'idle', waitingFor: null, title: 'triage', since: 0 },
        ],
      },
    ],
  },
]

/** A session host on a PTY that records what is done to it: attach PTYs are 60, 61, … */
export function fakeHost() {
  const log: string[] = []
  const exits: Record<PaneId, (code: number | null) => void> = {}
  let next = 60
  const pty: PtyClient = {
    spawn: async () => {
      const id = next++
      log.push(`spawn ${id}`)
      return id
    },
    write: async (id, d) => void log.push(`write ${id} ${JSON.stringify(d)}`),
    resize: async () => {},
    kill: async (id) => void log.push(`kill ${id}`),
    onExit: async (id, cb) => {
      exits[id] = cb
      return () => {}
    },
  }
  const host = createSessionHost({ pty, shell: () => 'posix', feed: () => {}, forget: () => {}, storage: null })
  return { host, log, exits }
}

/** Lets the attach's spawn and typing resolve. */
export const settle = () => new Promise((r) => setTimeout(r, 0))
