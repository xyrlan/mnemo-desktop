import type { MemoryFeed } from '../memory/types'
import type { RepoNode } from '../fleet/types'
import type { RunResult } from '../vault/types'
import { ago, createMemoryStore, targetOf, type LayoutView, type MemoryDeps } from './memory'

const repo = (over: Partial<RepoNode> = {}): RepoNode => ({
  root: '/r/app',
  name: 'app',
  worktrees: [
    { path: '/r/app-wt-x', name: 'x', branch: 'x', kind: 'workspace', agents: [], pr: null, unread: false },
    { path: '/r/app', name: 'app', branch: 'main', kind: 'main', agents: [], pr: null, unread: false },
  ],
  ...over,
})

const layout = (over: Partial<LayoutView> = {}): LayoutView => ({
  activeWorktree: '/r/app-wt-x',
  tabs: [{ id: 't1', root: { kind: 'leaf', pane: 7 }, focused: 7 }],
  activeTab: 't1',
  panes: { 7: { id: 7, view: 'terminal', cwd: '/r/app-wt-x/src' } },
  ...over,
})

describe('targetOf', () => {
  it('reads the chosen worktree and the session its focused pane was opened for', () => {
    const l = layout({ panes: { 7: { id: 7, view: 'terminal', sessionId: 's-pane' } } })
    expect(targetOf(l, [repo()])).toEqual({ cwd: '/r/app-wt-x', sessionId: 's-pane' })
  })

  it("takes the session the fleet found in the focused pane when the pane was not opened for one", () => {
    const r = repo()
    r.worktrees[0].agents = [
      { sessionId: 'other', paneId: 9, state: 'working', waitingFor: null, title: '', since: 0 },
      { sessionId: 's-fleet', paneId: 7, state: 'working', waitingFor: null, title: '', since: 0 },
    ]
    expect(targetOf(layout(), [r])).toEqual({ cwd: '/r/app-wt-x', sessionId: 's-fleet' })
  })

  it('has no session with no tab shown', () => {
    expect(targetOf(layout({ activeTab: '' }), [repo()])).toEqual({ cwd: '/r/app-wt-x', sessionId: null })
  })

  it("before a worktree is chosen, reads the first repo's main checkout, as the shell shows it", () => {
    expect(targetOf(layout({ activeWorktree: null }), [repo(), repo({ root: '/r/b' })])?.cwd).toBe('/r/app')
    expect(targetOf(layout({ activeWorktree: undefined }), [repo({ worktrees: [] })])?.cwd).toBe('/r/app')
  })

  it("with no repo known, reads the focused pane's folder, else nothing", () => {
    expect(targetOf(layout({ activeWorktree: null }), [])?.cwd).toBe('/r/app-wt-x/src')
    expect(targetOf(layout({ activeWorktree: null, activeTab: '' }), [])).toBeNull()
  })
})

test('ago counts in the largest whole unit', () => {
  const now = 1_000_000_000
  expect([0, 4_000, 12_000, 4 * 60_000, 2 * 3_600_000, 3 * 86_400_000, 15 * 86_400_000].map((d) => ago(now - d, now))).toEqual(['now', 'now', '12s', '4m', '2h', '3d', '2w'])
  expect(ago(now + 60_000, now)).toBe('now')
})

const feed = (over: Partial<MemoryFeed> = {}): MemoryFeed => ({
  project: 'app',
  briefing: null,
  fired: [],
  learned: [],
  inbox: [
    { key: 'feedback/a', type: 'feedback', title: 'A', excerpt: 'a' },
    { key: 'project/b', type: 'project', title: 'B', excerpt: 'b' },
  ],
  ...over,
})

const ok = (stdout: string): RunResult => ({ stdout, stderr: '', code: 0 })

function deps(over: Partial<MemoryDeps> = {}) {
  const calls: unknown[][] = []
  const d: MemoryDeps = {
    feed: async (cwd, sessionId) => {
      calls.push(['feed', cwd, sessionId])
      return feed({ project: cwd })
    },
    project: async (cwd) => {
      calls.push(['project', cwd])
      return { project: 'app', root: '/r/app' }
    },
    step: async (step, target, keys) => {
      calls.push(['step', step, target, keys])
      return ok(JSON.stringify({ [step === 'promote' ? 'promoted' : 'dropped']: keys, failed: [] }))
    },
    ...over,
  }
  return { d, calls }
}

describe('the memory store', () => {
  it('reads the feed for the worktree and session, and not again for the same target', async () => {
    const { d, calls } = deps()
    const s = createMemoryStore(d)
    await s.getState().show({ cwd: '/r/app', sessionId: 's1' })
    await s.getState().show({ cwd: '/r/app', sessionId: 's1' })
    expect(calls).toEqual([['feed', '/r/app', 's1']])
    expect(s.getState()).toMatchObject({ loading: false, error: null, feed: { project: '/r/app' } })
  })

  it('asks with no session when there is none', async () => {
    const { d, calls } = deps()
    await createMemoryStore(d).getState().show({ cwd: '/r/app', sessionId: null })
    expect(calls).toEqual([['feed', '/r/app', undefined]])
  })

  it("clears another worktree's feed at once, but keeps the worktree's own across a session change", async () => {
    let answer!: (f: MemoryFeed) => void
    const { d } = deps()
    const s = createMemoryStore(d)
    await s.getState().show({ cwd: '/r/a', sessionId: null })
    d.feed = () => new Promise((r) => (answer = r))
    void s.getState().show({ cwd: '/r/a', sessionId: 's2' })
    expect(s.getState()).toMatchObject({ loading: true, feed: { project: '/r/a' } })
    answer(feed({ project: '/r/a' }))
    void s.getState().show({ cwd: '/r/b', sessionId: 's2' })
    expect(s.getState().feed).toBeNull()
  })

  it('drops a reply that a newer read overtook', async () => {
    const answers: ((f: MemoryFeed) => void)[] = []
    const s = createMemoryStore(deps({ feed: () => new Promise((r) => answers.push(r)) }).d)
    const first = s.getState().show({ cwd: '/r/a', sessionId: null })
    const second = s.getState().show({ cwd: '/r/b', sessionId: null })
    answers[1](feed({ project: 'b' }))
    await second
    answers[0](feed({ project: 'a' }))
    await first
    expect(s.getState().feed?.project).toBe('b')
  })

  it("shows the core's refusal, and nothing with no target", async () => {
    const s = createMemoryStore(deps({ feed: async () => Promise.reject(new Error('no mnemo vault found')) }).d)
    await s.getState().show({ cwd: '/r/a', sessionId: null })
    expect(s.getState()).toMatchObject({ feed: null, error: 'no mnemo vault found', loading: false })
    await s.getState().show(null)
    expect(s.getState()).toMatchObject({ feed: null, error: null, target: null })
  })

  it('keeps a page by promoting its key in the main checkout, takes it off the list and reads again', async () => {
    const { d, calls } = deps()
    const s = createMemoryStore(d)
    await s.getState().show({ cwd: '/r/app-wt-x', sessionId: null })
    calls.length = 0
    d.feed = async () => feed({ inbox: [feed().inbox[1]] })
    const p = s.getState().decide('feedback/a', 'keep')
    expect(s.getState().deciding).toEqual({ 'feedback/a': 'keep' })
    await p
    expect(calls).toEqual([
      ['project', '/r/app-wt-x'],
      ['step', 'promote', { project: 'app', root: '/r/app' }, ['feedback/a']],
    ])
    expect(s.getState().deciding).toEqual({})
    expect(s.getState().feed?.inbox.map((i) => i.key)).toEqual(['project/b'])
  })

  it('drops a page, asking for the project only once per worktree', async () => {
    const { d, calls } = deps()
    const s = createMemoryStore(d)
    await s.getState().show({ cwd: '/r/app', sessionId: null })
    await s.getState().decide('feedback/a', 'drop')
    await s.getState().decide('project/b', 'drop')
    expect(calls.filter((c) => c[0] === 'project')).toHaveLength(1)
    expect(calls.filter((c) => c[0] === 'step').map((c) => [c[1], c[3]])).toEqual([
      ['drop', ['feedback/a']],
      ['drop', ['project/b']],
    ])
  })

  it('keeps a page it could not decide on the list, with what the CLI said', async () => {
    const s = createMemoryStore(
      deps({ step: async () => ok(JSON.stringify({ promoted: [], failed: [{ key: 'feedback/a', error: 'page is gone' }] })) }).d,
    )
    await s.getState().show({ cwd: '/r/app', sessionId: null })
    await s.getState().decide('feedback/a', 'keep')
    expect(s.getState().failed).toEqual({ 'feedback/a': 'page is gone' })
    expect(s.getState().feed?.inbox).toHaveLength(2)
  })

  it('says why when the CLI answered no JSON, or the worktree is in no repo', async () => {
    const noJson = createMemoryStore(deps({ step: async () => ({ stdout: '', stderr: 'mnemo: command not found', code: 127 }) }).d)
    await noJson.getState().show({ cwd: '/r/app', sessionId: null })
    await noJson.getState().decide('feedback/a', 'drop')
    expect(noJson.getState().failed['feedback/a']).toBe('mnemo: command not found')

    const noRepo = createMemoryStore(deps({ project: async () => null }).d)
    await noRepo.getState().show({ cwd: '/tmp', sessionId: null })
    await noRepo.getState().decide('feedback/a', 'keep')
    expect(noRepo.getState().failed['feedback/a']).toMatch(/not in a repo/)
  })

  it('asks for the project again after a failed lookup, and clears an old failure on retry', async () => {
    let n = 0
    const { d, calls } = deps({
      project: async () => {
        if (n++ === 0) throw new Error('boom')
        return { project: 'app', root: '/r/app' }
      },
    })
    const s = createMemoryStore(d)
    await s.getState().show({ cwd: '/r/app', sessionId: null })
    await s.getState().decide('feedback/a', 'keep')
    expect(s.getState().failed).toEqual({ 'feedback/a': 'boom' })
    await s.getState().decide('feedback/a', 'keep')
    expect(s.getState().failed).toEqual({})
    expect(calls.filter((c) => c[0] === 'step').map((c) => c[1])).toEqual(['promote'])
  })

  it('ignores a second click on a page being decided', async () => {
    let release!: () => void
    const { d, calls } = deps()
    const step = d.step
    d.step = async (...a) => {
      await new Promise<void>((r) => (release = r))
      return step(...a)
    }
    const s = createMemoryStore(d)
    await s.getState().show({ cwd: '/r/app', sessionId: null })
    const p = s.getState().decide('feedback/a', 'keep')
    await s.getState().decide('feedback/a', 'drop')
    await new Promise((r) => setTimeout(r, 0))
    release()
    await p
    expect(calls.filter((c) => c[0] === 'step').map((c) => c[1])).toEqual(['promote'])
  })
})
