import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { missionStore } from '../mission/app-store'
import { child, parent } from '../mission/fixtures'
import type { Pr, Snapshot } from '../mission/types'
import type { NexusClient } from './client'
import { NexusView } from './NexusView'
import type { ShipClient } from './ship-client'
import type { Feed, PrFate } from './ship-types'
import { SHIP_SPRITES } from './sprites'
import { nexusStore } from './store'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/* The launch on merge, end to end: the view's own `buildShip` and `logEvents` turn a snapshot into
   ships and milestones, and the scene plays the robot's exit from them. Only the drawer (Tauri,
   xterm) and the fleet module are stand-ins. Synthetic fleet. */

vi.mock('./drawer/app', async () => {
  const { fakeHost } = await import('./drawer/fixtures')
  const { createDrawer } = await import('./drawer/sessions')
  const { createStore } = await import('zustand/vanilla')
  const { nexusStore } = await import('./store')
  const { host } = fakeHost()
  const drawer = createDrawer(host, nexusStore, { goToPane: () => {}, attach: () => {}, closeNexus: () => {} })
  return {
    liveDrawer: {
      drawer,
      host,
      owners: createStore(() => ({ owners: {} })),
      terminal: () => <div />,
      conversation: () => <div />,
      diff: { files: async () => ({ root: '', files: [], truncated: false }), sides: async () => ({ original: '', modified: '', binary: false, tooLarge: false }) },
      worktreeOf: (cwd: string) => cwd,
      goToRepo: () => {},
      paneOfSession: () => null,
    },
  }
})
// One fleet for every render: a new one each time would rebuild the ship on every render.
const fleet = vi.hoisted(() => ({ repos: [] as unknown[] }))
vi.mock('../fleet/store', () => ({ useFleet: <T,>(sel: (f: { repos: unknown[] }) => T) => sel(fleet) }))

const ROOT = '/home/dev/mnemo-desktop'
const CAPTAIN = 'aaaaaaaa-1111-4000-8000-000000000001'
const ID = 'd0000001'
const URL = 'https://github.com/example/mnemo-desktop/pull/701'
const MIN = 60_000
const now = Date.now()
const iso = (ms: number) => new Date(ms).toISOString()

const pr = (over: Partial<Pr> = {}): Pr => ({ number: 701, url: URL, state: 'OPEN', head: 'fix/issue-684', ci: 'pass', ...over })
const green = (over: Partial<PrFate> = {}): PrFate => ({
  state: 'OPEN',
  mergedAt: null,
  closedAt: null,
  checks: [{ name: 'test', startedAt: now - 30 * MIN, completedAt: now - 20 * MIN, conclusion: 'SUCCESS' }],
  ...over,
})

/** One captain and its finished child, whose PR is `p`. */
const snapshot = (p: Pr): Snapshot => ({
  repos: [
    {
      root: ROOT,
      name: 'mnemo-desktop',
      parents: [parent({ session_id: CAPTAIN, status: 'busy', cwd: ROOT, name: 'round' })],
      missions: [],
      children: [
        child({ id: ID, session_id: `${ID}-4444-4000-8000-000000000001`, state: 'done', tempo: 'idle', live: false, cwd: `${ROOT}-wt-684`, updated_at: iso(now - 10 * MIN), parent_session: CAPTAIN, detail: 'PR open, CI green', pr: p }),
      ],
    },
  ],
  errors: [],
  at: iso(now),
})
const feed = (fate: PrFate): Feed => ({ sessions: {}, prs: { [URL]: fate }, rate: null, at: now })

const usage: NexusClient = { logUsage: async () => {} }
let root: Root | null = null
let host: HTMLElement

async function open(first: Feed) {
  const client: ShipClient = { feed: async () => first }
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await act(async () => root!.render(<NexusView client={client} usage={usage} />))
  // The first feed has landed: from here the view logs milestones.
  await act(async () => {})
}

beforeEach(() => {
  nexusStore.setState({ open: true, feed: null, log: [], tabs: [] })
  missionStore.setState({ snapshot: snapshot(pr()) })
})
afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

const $ = (sel: string) => host.querySelector<HTMLElement>(sel)
const end = (el: Element, name: string) =>
  act(async () => {
    const e = new Event('animationend', { bubbles: true })
    Object.defineProperty(e, 'animationName', { value: name })
    el.dispatchEvent(e)
  })

/** The robot waits in the hangar on its green PR, then the PR merges: it boards its shuttle and
 *  launches, and never walks off. */
async function expectLaunch() {
  const leaving = $(`[data-leaving="${ID}"]`)
  expect($(`.ship-robot[data-ship-id="${ID}"]`)).toBeNull()
  expect(leaving?.dataset.exit).toBe('launch')
  expect(leaving!.querySelector('img')!.getAttribute('src')).toBe(SHIP_SPRITES.shuttle.launch.src)
  expect($('.ship-walk-off')).toBeNull()
  expect(nexusStore.getState().log.some((e) => e.kind === 'merged' && e.robotId === ID)).toBe(true)
  await end(leaving!.querySelector('.ship-launch')!, 'ship-launch')
  expect($('[data-leaving]')).toBeNull()
}

test('the snapshot says merged: the robot launches', async () => {
  await open(feed(green()))
  // In the hangar, listed on the bridge as ready to merge.
  expect($(`.ship-robot[data-ship-id="${ID}"]`)).not.toBeNull()
  expect($('[data-zone="hangar"] .ship-rcount')!.textContent).toBe('1')
  expect($(`[data-row="ready:${ID}"]`)).not.toBeNull()
  await act(async () => missionStore.setState({ snapshot: snapshot(pr({ state: 'MERGED' })) }))
  await expectLaunch()
})

test('only the feed has read the merge (the snapshot still says open): the robot launches', async () => {
  await open(feed(green()))
  expect($(`.ship-robot[data-ship-id="${ID}"]`)).not.toBeNull()
  await act(async () => nexusStore.getState().setFeed(feed(green({ state: 'MERGED', mergedAt: now - MIN }))))
  await expectLaunch()
})
