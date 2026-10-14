import { afterEach, beforeEach, expect, test } from 'vitest'
import type { AgentEvent } from '../agents/events'
import { createFleet } from '../fleet/create'
import { HOOK_TRUST_MS } from '../fleet/model'
import type { WorktreeInfo } from '../fleet/upstream'
import type { HomeSnapshot } from '../home/types'
import { child, parent } from '../mission/fixtures'
import type { ChildSession, ParentSession, Snapshot } from '../mission/types'
import { createNotifier, SOUND_GAP_MS } from './notifier'

// The fleet and the notifier as the app wires them (`view.tsx`): hook events reach both, and the
// fleet passes on what its polls see move. Off screen, unfocused: every alert is a native one.

const ROOT = '/Users/me/github/app'
const WT = '/Users/me/github/app-wt-login'
const KID = '/Users/me/github/app-wt-c-cards'
const TREES: WorktreeInfo[] = [
  { path: ROOT, branch: 'main', head: 'a', isMain: true, dispatched: false, dirty: false, setupJob: null },
  { path: WT, branch: 'login', head: 'a', isMain: false, dispatched: false, dirty: false, setupJob: null },
  { path: KID, branch: 'feat/x/cards', head: 'a', isMain: false, dispatched: true, dirty: false, setupJob: null },
]
const HOME: HomeSnapshot = {
  repos: [{ root: ROOT, name: 'app', last_at: 0, pinned: false, hidden: false, unresolved: false, sessions: [], children: [] }],
  clone_base: '',
  errors: [],
  protected: 0,
}

let t: number
let polls: number
let mission: Snapshot
let native: Array<[string, string]>
const offs: Array<() => void> = []

function app(opts: { hooks: boolean }) {
  const hooks = new Set<(e: AgentEvent) => void>()
  const changed = new Set<() => void>()
  const fleet = createFleet(
    {
      home: () => HOME,
      mission: () => mission,
      panes: () => ({}),
      shown: () => ROOT,
      listWorktrees: async () => TREES,
      subscribeAgentEvents: (cb) => (hooks.add(cb), () => void hooks.delete(cb)),
      onChange: (cb) => (changed.add(cb), () => void changed.delete(cb)),
      reload: async () => {},
      now: () => t,
    },
    { pollMs: 1e9 },
  )
  offs.push(fleet.connect())
  const notifier = createNotifier({
    subscribe: (cb) => (hooks.add(cb), () => void hooks.delete(cb)),
    polled: fleet.onPolledMove,
    repos: () => fleet.store.getState().repos,
    active: () => ROOT,
    shownPanes: () => [],
    focused: () => false,
    onLook: () => () => {},
    native: async (title, body) => void native.push([title, body]),
    sound: () => {},
    switchTo: () => {},
    now: () => t,
  })
  offs.push(notifier.stop)
  return {
    later(ms: number) {
      t += ms
    },
    poll(parents: ParentSession[], children: ChildSession[] = []) {
      mission = { repos: [{ root: ROOT, name: 'app', parents, missions: [], children }], errors: [], at: `poll ${++polls}` }
      changed.forEach((cb) => cb())
    },
    hook(e: Omit<AgentEvent, 'at'>) {
      if (opts.hooks) hooks.forEach((cb) => cb({ ...e, at: t }))
    },
    settle: () => new Promise((r) => setTimeout(r, 0)),
  }
}

beforeEach(() => {
  t = 1_000_000
  polls = 0
  mission = { repos: [], errors: [], at: '' }
  native = []
})
afterEach(() => offs.splice(0).forEach((off) => off()))

const busy = (cwd: string) => parent({ session_id: 's', status: 'busy', cwd, name: 'Fix login' })
const asking = (cwd: string) => parent({ session_id: 's', status: 'waiting', waiting_for: 'permission prompt', cwd, name: 'Fix login' })
const idle = (cwd: string) => parent({ session_id: 's', status: 'idle', cwd, name: 'Fix login' })

// One session's life: it asks, is answered, finishes. Each step lands on a poll; with hooks, the
// hook fires first, as it does, and a poll before it is the race case at the end.
async function life(a: ReturnType<typeof app>) {
  await a.settle()
  a.poll([busy(WT)])
  a.later(5_000)
  a.hook({ sessionId: 's', cwd: WT, kind: 'notification', message: 'Claude needs your permission to use Bash' })
  a.later(HOOK_TRUST_MS)
  a.poll([asking(WT)])
  a.later(5_000)
  a.hook({ sessionId: 's', cwd: WT, kind: 'prompt', message: 'yes' })
  a.later(SOUND_GAP_MS)
  a.hook({ sessionId: 's', cwd: WT, kind: 'stop' })
  a.later(HOOK_TRUST_MS)
  a.poll([idle(WT)])
}

test('polled transitions alone notify a finished turn and an ask (no hook socket: Windows)', async () => {
  await life(app({ hooks: false }))
  expect(native).toEqual([
    ['app · login', 'Claude needs your permission'],
    ['app · login', 'Finished: Fix login'],
  ])
})

test('hooks and polls together: one notification per event, in the hook’s words', async () => {
  await life(app({ hooks: true }))
  expect(native).toEqual([
    ['app · login', 'Claude needs your permission to use Bash'],
    ['app · login', 'Finished: Fix login'],
  ])
})

test('a poll that sees the ask before its hook lands: still one notification', async () => {
  const a = app({ hooks: true })
  await a.settle()
  a.poll([busy(WT)])
  a.later(30_000)
  a.poll([asking(WT)])
  a.later(SOUND_GAP_MS)
  a.hook({ sessionId: 's', cwd: WT, kind: 'notification', message: 'Claude needs your permission to use Bash' })
  expect(native).toEqual([['app · login', 'Claude needs your permission']])
})

test('a dispatched child’s question notifies, though children send no hooks on any platform', async () => {
  const a = app({ hooks: true })
  await a.settle()
  const working = child({ id: 'c1c1c1c1', session_id: 'c1c1c1c1-full', cwd: KID, name: 'cards' })
  a.poll([], [working])
  a.later(30_000)
  a.poll([], [{ ...working, tempo: 'blocked', needs: 'which colour for the badge?' }])
  expect(native).toEqual([['app · c-cards', 'which colour for the badge?']])
})
