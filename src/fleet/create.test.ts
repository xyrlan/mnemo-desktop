import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HomeRepo, HomeSnapshot } from '../home/types'
import type { ChildSession, ParentSession, Snapshot } from '../mission/types'
import { child, parent } from '../mission/fixtures'
import { createFleet, PRS_EVERY, type FleetSources } from './create'
import { HOOK_TRUST_MS } from './model'
import type { AgentEvent, WorktreeInfo } from './upstream'
import type { Fleet, WorktreeNode } from './types'

const ROOT = '/Users/me/github/app'
const WT = '/Users/me/github/app-wt-login'
const KID = '/Users/me/github/app-wt-c-cards'

const tree = (path: string, over: Partial<WorktreeInfo> = {}): WorktreeInfo => ({
  path, branch: null, head: 'abc', isMain: false, dispatched: false, dirty: false, setupJob: null, ...over,
})
const TREES: WorktreeInfo[] = [
  tree(WT, { branch: 'login' }),
  tree(ROOT, { branch: 'main', isMain: true }),
  tree(KID, { branch: 'feat/redesign/cards', dispatched: true }),
]

const repo = (root: string, over: Partial<HomeRepo> = {}): HomeRepo => ({
  root, name: root.split('/').pop()!, last_at: 0, pinned: false, hidden: false, unresolved: false, sessions: [], children: [], ...over,
})
const homeOf = (...repos: HomeRepo[]): HomeSnapshot => ({ repos, clone_base: '', errors: [], protected: 0 })

let polls = 0
const missionOf = (parents: ParentSession[], children: ChildSession[] = [], errors: string[] = []): Snapshot => ({
  repos: [{ root: ROOT, name: 'app', parents, missions: [], children }],
  errors,
  at: `poll ${++polls}`,
})

const EMPTY_MISSION: Snapshot = { repos: [], errors: [], at: '' }

function harness(opts: { home?: HomeSnapshot; trees?: Record<string, WorktreeInfo[] | Error> } = {}) {
  const s = {
    t: 1_000_000,
    home: opts.home ?? homeOf(repo(ROOT)),
    mission: EMPTY_MISSION,
    panes: {} as Record<number, { id: number; sessionId?: string }>,
    shown: null as string | null,
    trees: opts.trees ?? { [ROOT]: TREES },
  }
  const changed = new Set<() => void>()
  let hook: ((e: AgentEvent) => void) | null = null
  const unhooked = vi.fn()
  const listWorktrees = vi.fn(async (root: string) => {
    const t = s.trees[root]
    if (!t || t instanceof Error) throw t ?? new Error('not a git repository')
    return t
  })
  const reload = vi.fn(async (_o: { withPrs: boolean; home: boolean }) => {})
  const src: FleetSources = {
    home: () => s.home,
    mission: () => s.mission,
    panes: () => s.panes,
    shown: () => s.shown,
    listWorktrees,
    subscribeAgentEvents: (cb) => {
      hook = cb
      return unhooked
    },
    onChange: (cb) => {
      changed.add(cb)
      return () => changed.delete(cb)
    },
    reload,
    now: () => s.t,
  }
  const fleet = createFleet(src, { pollMs: 1e9 })
  const stop = fleet.connect()
  stops.push(stop)
  const fire = () => changed.forEach((cb) => cb())
  return {
    s,
    fleet,
    listWorktrees,
    reload,
    unhooked,
    stop,
    get: (): Fleet => fleet.store.getState(),
    wt: (path: string): WorktreeNode => fleet.store.getState().repos.flatMap((r) => r.worktrees).find((w) => w.path === path)!,
    poll(parents: ParentSession[], children: ChildSession[] = [], errors: string[] = []) {
      s.mission = missionOf(parents, children, errors)
      fire()
    },
    fire,
    emit(e: Partial<AgentEvent> & Pick<AgentEvent, 'sessionId' | 'kind'>) {
      hook!({ cwd: ROOT, at: s.t, ...e })
    },
    later(ms: number) {
      s.t += ms
    },
    settle: () => new Promise((r) => setTimeout(r, 0)),
  }
}

const stops: Array<() => void> = []
afterEach(() => {
  stops.splice(0).forEach((stop) => stop())
})

describe('the tree', () => {
  it('lists each known repo with its worktrees, the main checkout first', async () => {
    const h = harness()
    await h.settle()
    expect(h.get().repos).toEqual([
      {
        root: ROOT,
        name: 'app',
        worktrees: [
          { path: ROOT, name: 'app', branch: 'main', kind: 'main', agents: [], pr: null, unread: false },
          { path: KID, name: 'c-cards', branch: 'feat/redesign/cards', kind: 'dispatched', agents: [], pr: null, unread: false },
          { path: WT, name: 'login', branch: 'login', kind: 'workspace', agents: [], pr: null, unread: false },
        ],
      },
    ])
  })

  it('leaves out repos Home hides, and never lists an unresolved one, which would run git in a guarded folder', async () => {
    const h = harness({ home: homeOf(repo(ROOT), repo('/Users/me/secret', { hidden: true }), repo('/Users/me/Documents/x', { unresolved: true })) })
    await h.settle()
    expect(h.get().repos.map((r) => r.root)).toEqual([ROOT])
    expect(h.listWorktrees.mock.calls.map((c) => c[0])).toEqual([ROOT])
  })

  it('shows a repo git cannot list as its main checkout, and keeps the last listing when a later one fails', async () => {
    const h = harness({ trees: { [ROOT]: new Error('git is busy') } })
    await h.settle()
    expect(h.get().repos[0].worktrees.map((w) => [w.path, w.kind])).toEqual([[ROOT, 'main']])

    h.s.trees[ROOT] = TREES
    await h.get().refresh()
    h.s.trees[ROOT] = new Error('index.lock')
    await h.get().refresh()
    expect(h.get().repos[0].worktrees).toHaveLength(3)
  })

  it('adds a repo only the mission snapshot knows, once git lists it, and not a folder that is no repo', async () => {
    const other = '/Users/me/github/other'
    const h = harness({ home: homeOf(), trees: { [other]: [tree(other, { isMain: true, branch: 'main' })] } })
    h.s.mission = {
      repos: [
        { root: other, name: 'other', parents: [parent({ session_id: 's1', status: 'busy', cwd: other })], missions: [], children: [] },
        { root: '/Users/me/probe', name: 'probe', parents: [parent({ session_id: 's2', status: 'busy', cwd: '/Users/me/probe' })], missions: [], children: [] },
      ],
      errors: [],
      at: 'x',
    }
    h.fire()
    await h.settle()
    expect(h.get().repos.map((r) => r.root)).toEqual([other])
    expect(h.get().repos[0].worktrees[0].agents.map((a) => a.sessionId)).toEqual(['s1'])
  })

  it('puts an agent in the deepest worktree its cwd is in, and leaves out one in no worktree', async () => {
    const h = harness()
    await h.settle()
    h.poll([
      parent({ session_id: 'main', status: 'busy', cwd: `${ROOT}/src` }),
      parent({ session_id: 'side', status: 'busy', cwd: WT }),
      parent({ session_id: 'nowhere', status: 'busy', cwd: '/tmp' }),
    ])
    expect(h.wt(ROOT).agents.map((a) => a.sessionId)).toEqual(['main'])
    expect(h.wt(WT).agents.map((a) => a.sessionId)).toEqual(['side'])
    expect(JSON.stringify(h.get().repos)).not.toContain('nowhere')
  })

  it('gives a tree nested in the checkout (Claude Code’s .claude/worktrees) its own agents', async () => {
    const nested = `${ROOT}/.claude/worktrees/fix`
    const h = harness({ trees: { [ROOT]: [...TREES, tree(nested, { branch: 'fix' })] } })
    await h.settle()
    h.poll([parent({ session_id: 'n', status: 'busy', cwd: `${nested}/src` })])
    expect(h.wt(nested).agents.map((a) => a.sessionId)).toEqual(['n'])
    expect(h.wt(ROOT).agents).toEqual([])
  })

  it('names an agent by Home’s title, else by what claude agents calls it, and finds the pane that runs it', async () => {
    const h = harness({ home: homeOf(repo(ROOT, { sessions: [{ id: 'a', title: 'fix the login', cwd: ROOT, last_at: 0, transcript: true, live: 'here', kind: 'interactive', agent: null }] })) })
    h.s.panes = { 7: { id: 7, sessionId: 'a' }, 8: { id: 8 } }
    await h.settle()
    h.poll([parent({ session_id: 'a', status: 'busy', cwd: ROOT }), parent({ session_id: 'b', status: 'busy', cwd: ROOT, name: 'refactor' })])
    expect(h.wt(ROOT).agents.map((a) => [a.title, a.paneId])).toEqual([
      ['fix the login', 7],
      ['refactor', null],
    ])
  })

  it('orders agents: waiting on you, working, done, idle', async () => {
    const h = harness()
    await h.settle()
    h.poll([
      parent({ session_id: 'i', status: 'idle', cwd: ROOT }),
      parent({ session_id: 'w', status: 'busy', cwd: ROOT }),
      parent({ session_id: 'n', status: 'waiting', waiting_for: 'permission prompt', cwd: ROOT }),
    ])
    expect(h.wt(ROOT).agents.map((a) => a.state)).toEqual(['needs-you', 'working', 'idle'])
  })

  it('does not publish a new tree when a poll changes nothing', async () => {
    const h = harness()
    await h.settle()
    h.poll([parent({ session_id: 'a', status: 'busy', cwd: ROOT })])
    const before = h.get().repos
    h.later(3000)
    h.poll([parent({ session_id: 'a', status: 'busy', cwd: ROOT })])
    expect(h.get().repos).toBe(before)
  })
})

describe('state from polling', () => {
  it('reads busy as working, and idle after it as done', async () => {
    const h = harness()
    await h.settle()
    h.poll([parent({ session_id: 'a', status: 'busy', cwd: ROOT })])
    expect(h.wt(ROOT).agents[0]).toMatchObject({ state: 'working', since: 1_000_000 })
    h.later(5000)
    h.poll([parent({ session_id: 'a', status: 'idle', cwd: ROOT })])
    expect(h.wt(ROOT).agents[0]).toMatchObject({ state: 'done', since: 1_005_000 })
  })

  it('reads a session first seen idle as idle', async () => {
    const h = harness()
    await h.settle()
    h.poll([parent({ session_id: 'a', status: 'idle', cwd: ROOT })])
    expect(h.wt(ROOT).agents[0].state).toBe('idle')
    expect(h.wt(ROOT).unread).toBe(false)
  })

  it('tells a permission from a question, and leaves a dialog the user opened alone', async () => {
    const h = harness()
    await h.settle()
    h.poll([
      parent({ session_id: 'p', status: 'waiting', waiting_for: 'permission prompt', cwd: ROOT }),
      parent({ session_id: 'q', status: 'waiting', waiting_for: 'input needed', cwd: WT }),
      parent({ session_id: 'd', status: 'waiting', waiting_for: 'dialog open', cwd: KID }),
    ])
    expect(h.wt(ROOT).agents[0]).toMatchObject({ state: 'needs-you', waitingFor: 'permission' })
    expect(h.wt(WT).agents[0]).toMatchObject({ state: 'needs-you', waitingFor: 'question' })
    expect(h.wt(KID).agents[0]).toMatchObject({ state: 'idle', waitingFor: null })
  })

  it('drops a session the next poll no longer lists, but not when that poll failed', async () => {
    const h = harness()
    await h.settle()
    h.poll([parent({ session_id: 'a', status: 'busy', cwd: ROOT })])
    h.poll([], [], ['claude: command not found'])
    expect(h.wt(ROOT).agents).toHaveLength(1)
    h.poll([])
    expect(h.wt(ROOT).agents).toHaveLength(0)
  })

  it('reads a dispatched child from mnemo sessions', async () => {
    const h = harness()
    await h.settle()
    h.poll([], [child({ id: 'c1', session_id: 'c1-full', cwd: KID, tempo: 'blocked', needs: 'approve Bash: rm -rf dist' })])
    expect(h.wt(KID).agents[0]).toMatchObject({ sessionId: 'c1-full', state: 'needs-you', waitingFor: 'permission' })
    h.poll([], [child({ id: 'c1', session_id: 'c1-full', cwd: KID, state: 'done', tempo: 'idle', live: false, updated_at: new Date(h.s.t).toISOString() })])
    expect(h.wt(KID).agents[0].state).toBe('done')
  })

  it('does not light up a child found already finished', async () => {
    const h = harness()
    await h.settle()
    h.poll([], [child({ id: 'c1', cwd: KID, state: 'done', tempo: 'idle', live: false, updated_at: new Date(h.s.t).toISOString() })])
    expect(h.wt(KID).agents[0].state).toBe('done')
    expect(h.wt(KID).unread).toBe(false)
  })

  it('leaves out a child that finished hours ago', async () => {
    const h = harness()
    await h.settle()
    h.poll([], [child({ id: 'old', cwd: KID, state: 'done', tempo: 'idle', live: false, updated_at: new Date(h.s.t - 24 * 3600_000).toISOString() })])
    expect(h.wt(KID).agents).toEqual([])
  })
})

describe('state from hooks', () => {
  it('moves the moment a hook says so', async () => {
    const h = harness()
    await h.settle()
    h.emit({ sessionId: 'a', kind: 'start', cwd: WT })
    expect(h.wt(WT).agents[0]).toMatchObject({ sessionId: 'a', state: 'idle' })
    h.emit({ sessionId: 'a', kind: 'prompt', cwd: WT })
    expect(h.wt(WT).agents[0].state).toBe('working')
    h.emit({ sessionId: 'a', kind: 'notification', message: 'Claude needs your permission to use Bash', cwd: WT })
    expect(h.wt(WT).agents[0]).toMatchObject({ state: 'needs-you', waitingFor: 'permission' })
    h.emit({ sessionId: 'a', kind: 'stop', cwd: WT })
    expect(h.wt(WT).agents[0]).toMatchObject({ state: 'done', waitingFor: null })
    h.emit({ sessionId: 'a', kind: 'end', cwd: WT })
    expect(h.wt(WT).agents).toEqual([])
  })

  it('ignores the idle nudge, and a start that is a /clear or a compaction mid-turn', async () => {
    const h = harness()
    await h.settle()
    h.emit({ sessionId: 'a', kind: 'prompt' })
    h.emit({ sessionId: 'a', kind: 'start' })
    h.emit({ sessionId: 'a', kind: 'notification', message: 'Claude is waiting for your input' })
    expect(h.wt(ROOT).agents[0].state).toBe('working')
  })

  it('reads any other notification as a question', async () => {
    const h = harness()
    await h.settle()
    h.emit({ sessionId: 'a', kind: 'notification', message: 'Claude has a question for you' })
    expect(h.wt(ROOT).agents[0]).toMatchObject({ state: 'needs-you', waitingFor: 'question' })
  })

  it('is not overruled by a poll landing right after it, only by a later one', async () => {
    const h = harness()
    await h.settle()
    h.poll([parent({ session_id: 'a', status: 'busy', cwd: ROOT })])
    h.emit({ sessionId: 'a', kind: 'stop' })
    h.later(HOOK_TRUST_MS - 1000)
    h.poll([parent({ session_id: 'a', status: 'busy', cwd: ROOT })])
    expect(h.wt(ROOT).agents[0].state).toBe('done')
    h.later(2000)
    h.poll([parent({ session_id: 'a', status: 'busy', cwd: ROOT })])
    expect(h.wt(ROOT).agents[0].state).toBe('working')
  })

  it('keeps a session a hook just started though the poll does not list it yet', async () => {
    const h = harness()
    await h.settle()
    h.emit({ sessionId: 'new', kind: 'prompt' })
    h.poll([])
    expect(h.wt(ROOT).agents.map((a) => a.sessionId)).toEqual(['new'])
    h.later(HOOK_TRUST_MS)
    h.poll([])
    expect(h.wt(ROOT).agents).toEqual([])
  })

  it('matches a hook to a child mnemo knows only by its short id', async () => {
    const h = harness()
    await h.settle()
    h.poll([], [child({ id: 'c1c1c1c1', cwd: KID })])
    h.emit({ sessionId: 'c1c1c1c1-2222-3333', kind: 'stop', cwd: KID })
    expect(h.wt(KID).agents).toHaveLength(1)
    expect(h.wt(KID).agents[0]).toMatchObject({ sessionId: 'c1c1c1c1', state: 'done' })
  })
})

describe('unread', () => {
  it('lights a worktree when an agent finishes or asks, until it is marked read', async () => {
    const h = harness()
    await h.settle()
    h.emit({ sessionId: 'a', kind: 'prompt', cwd: WT })
    expect(h.wt(WT).unread).toBe(false)
    h.later(1000)
    h.emit({ sessionId: 'a', kind: 'stop', cwd: WT })
    expect(h.wt(WT).unread).toBe(true)
    h.later(1000)
    h.get().markRead(WT + '/')
    expect(h.wt(WT).unread).toBe(false)
    // Still done, nothing new: stays read.
    h.later(HOOK_TRUST_MS)
    h.poll([parent({ session_id: 'a', status: 'idle', cwd: WT })])
    expect(h.wt(WT).unread).toBe(false)
    h.later(1000)
    h.emit({ sessionId: 'a', kind: 'notification', message: 'Claude needs your permission to use Edit', cwd: WT })
    expect(h.wt(WT).unread).toBe(true)
  })

  it('lights one found waiting on you at launch', async () => {
    const h = harness()
    await h.settle()
    h.poll([parent({ session_id: 'a', status: 'waiting', waiting_for: 'input needed', cwd: WT })])
    expect(h.wt(WT).unread).toBe(true)
    expect(h.wt(ROOT).unread).toBe(false)
  })

  it('never lights the worktree being shown', async () => {
    const h = harness()
    await h.settle()
    h.s.shown = WT
    h.emit({ sessionId: 'a', kind: 'prompt', cwd: WT })
    h.emit({ sessionId: 'a', kind: 'stop', cwd: WT })
    expect(h.wt(WT).unread).toBe(false)
  })

  it('goes out with the agent that lit it', async () => {
    const h = harness()
    await h.settle()
    h.emit({ sessionId: 'a', kind: 'prompt', cwd: WT })
    h.emit({ sessionId: 'a', kind: 'stop', cwd: WT })
    h.emit({ sessionId: 'a', kind: 'end', cwd: WT })
    expect(h.wt(WT).unread).toBe(false)
  })
})

describe('PRs', () => {
  it('reads a dispatched tree’s PR from its child, merged and closed ones too', async () => {
    const h = harness()
    await h.settle()
    const pr = { number: 12, url: 'u', state: 'OPEN', head: 'feat/redesign/cards', ci: 'fail' as const, draft: true }
    h.poll([], [child({ id: 'c1', cwd: KID, branch: 'feat/redesign/cards', pr })])
    expect(h.wt(KID).pr).toEqual({ number: 12, state: 'draft', checks: 'failing' })
    h.poll([], [child({ id: 'c1', cwd: KID, branch: 'feat/redesign/cards', pr: { ...pr, state: 'MERGED', ci: 'pass' } })])
    expect(h.wt(KID).pr).toEqual({ number: 12, state: 'merged', checks: 'passing' })
  })

  it('reads a contract piece’s PR by its branch', async () => {
    const h = harness()
    await h.settle()
    h.s.mission = {
      repos: [
        {
          root: ROOT, name: 'app', parents: [], children: [],
          missions: [{ feature: 'redesign', contract_path: '', landable: false, pieces: [{ name: 'cards', branch: 'feat/redesign/cards', child: null, pr: { number: 3, url: '', state: 'CLOSED', head: 'feat/redesign/cards', ci: 'none' } }] }],
        },
      ],
      errors: [],
      at: 'x',
    }
    h.fire()
    expect(h.wt(KID).pr).toEqual({ number: 3, state: 'closed', checks: null })
  })

  it('falls back to Home’s open PR, tied to the child that opened it', async () => {
    const home = homeOf(
      repo(ROOT, {
        children: [{ id: 'c1c1c1c1-full', title: 'cards', cwd: KID, last_at: 0, transcript: true, live: null, kind: 'background', agent: null }],
        prs: [{ number: 9, title: 'cards', state: 'open', checks: 'pending', child: 'c1c1c1c1', url: '' }],
      }),
    )
    const h = harness({ home })
    await h.settle()
    expect(h.wt(KID).pr).toEqual({ number: 9, state: 'open', checks: 'pending' })
    expect(h.wt(WT).pr).toBeNull()
  })
})

describe('polling', () => {
  it('asks for PRs on the first poll, and relists worktrees on each', async () => {
    const h = harness()
    await h.settle()
    expect(h.reload).toHaveBeenCalledWith({ withPrs: true, home: false })
    expect(PRS_EVERY).toBeGreaterThan(1)
  })

  it('asks Home too when it has no snapshot yet', async () => {
    const h = harness({ home: homeOf() })
    await h.settle()
    expect(h.reload).toHaveBeenCalledWith({ withPrs: true, home: true })
  })

  it('refresh reloads everything and lists worktrees made outside the app', async () => {
    const h = harness()
    await h.settle()
    h.s.trees[ROOT] = [...TREES, tree('/Users/me/github/app-wt-new', { branch: 'new' })]
    h.reload.mockClear()
    await h.get().refresh()
    expect(h.reload).toHaveBeenCalledWith({ withPrs: true, home: true })
    expect(h.get().repos[0].worktrees.map((w) => w.name)).toContain('new')
  })

  it('stops listening when disconnected', async () => {
    const h = harness()
    await h.settle()
    h.stop()
    expect(h.unhooked).toHaveBeenCalled()
    h.poll([parent({ session_id: 'a', status: 'busy', cwd: ROOT })])
    expect(h.wt(ROOT).agents).toEqual([])
  })
})
