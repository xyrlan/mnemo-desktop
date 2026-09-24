import {
  answerRemove,
  archiveStore,
  closeCleanup,
  confirmCleanup,
  forgetRepo,
  openCleanup,
  removeSelected,
  requestRemove,
  scanCleanup,
  selectAll,
  toggleSelected,
} from './archive'
import { classify, isStale, keptSummary, staleLabel } from './cleanup-model'
import {
  agent,
  cleanupFacts,
  fleetStore,
  forgetProject,
  gitFacts,
  gitTree,
  layoutStore,
  listWorktrees,
  refusals,
  removeWorktree,
  repo,
  resetFakes,
  toast,
  tree,
} from './testing'

vi.mock('./upstream', () => import('./testing'))

beforeEach(() => resetFakes())

const cleanup = () => archiveStore.getState().cleanup
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('what makes a worktree stale', () => {
  const r = repo('/r/app', [])
  const facts = (more: Partial<ReturnType<typeof gitTree>> = {}) => ({ base: 'origin/main', trees: [gitTree('/r/app-wt-x', more)] })

  test('merged into the default branch, or its PR merged or closed', () => {
    expect(classify(r, tree('/r/app-wt-x'), facts({ merged: true }))).toMatchObject({ stale: ['merged'], keep: [] })
    const merged = classify(r, tree('/r/app-wt-x', { pr: { number: 4, state: 'merged', checks: null } }), facts())
    expect(merged).toMatchObject({ stale: ['pr-merged'], keep: [], repoName: 'app', base: 'origin/main' })
    const closed = classify(r, tree('/r/app-wt-x', { pr: { number: 5, state: 'closed', checks: null } }), facts({ merged: true }))
    expect(closed.stale).toEqual(['pr-closed', 'merged'])
    expect([merged, closed].every(isStale)).toBe(true)
  })

  test('kept for changes, an agent at work, setup running, nothing saying it is done, or git not listing it', () => {
    const keep = (t: ReturnType<typeof tree>, f: ReturnType<typeof facts>) => classify(r, t, f).keep
    expect(keep(tree('/r/app-wt-x'), facts({ merged: true, dirty: true }))).toEqual(['changes'])
    expect(keep(tree('/r/app-wt-x', { agents: [agent('a', 'working')] }), facts({ merged: true }))).toEqual(['agent'])
    expect(keep(tree('/r/app-wt-x', { agents: [agent('a', 'needs-you')] }), facts({ merged: true }))).toEqual(['agent'])
    expect(keep(tree('/r/app-wt-x', { agents: [agent('a', 'done'), agent('b', 'idle')] }), facts({ merged: true }))).toEqual([])
    expect(keep(tree('/r/app-wt-x'), facts({ merged: true, setupJob: 'j' }))).toEqual(['setup'])
    expect(keep(tree('/r/app-wt-x'), facts())).toEqual(['unmerged'])
    // A merged PR does not make a stranger to git safe to remove.
    const stranger = classify(r, tree('/r/app-wt-y', { pr: { number: 1, state: 'merged', checks: null } }), facts())
    expect(stranger.keep).toEqual(['unchecked'])
    expect(isStale(stranger)).toBe(false)
  })

  test('git’s spelling of a path with a trailing slash still matches the fleet’s', () => {
    expect(classify(r, tree('/r/app-wt-x'), { base: null, trees: [gitTree('/r/app-wt-x/', { merged: true })] }).keep).toEqual([])
  })

  test('labels: the PR, or the branch it is in', () => {
    const pr = { number: 9, state: 'merged' as const, checks: null }
    expect(staleLabel('pr-merged', { pr, base: null })).toBe('PR #9 merged')
    expect(staleLabel('pr-closed', { pr, base: null })).toBe('PR #9 closed')
    expect(staleLabel('merged', { pr: null, base: 'origin/main' })).toBe('In origin/main')
    expect(staleLabel('merged', { pr: null, base: null })).toBe('Merged')
    expect(keptSummary([{ keep: ['unmerged'] }, { keep: ['changes', 'agent'] }, { keep: ['unmerged'] }, { keep: ['agent'] }])).toBe(
      '1 with changes · 1 with an agent at work · 2 not merged',
    )
    expect(keptSummary([])).toBe('')
  })
})

function twoRepos() {
  fleetStore.setState({
    repos: [
      repo('/r/app', [
        tree('/r/app', { kind: 'main' }),
        tree('/r/app-wt-done', { kind: 'dispatched' }),
        tree('/r/app-wt-wip'),
        tree('/r/app-wt-shipped', { pr: { number: 7, state: 'merged', checks: null } }),
      ]),
      repo('/r/web', [tree('/r/web', { kind: 'main' }), tree('/r/web-wt-old')]),
      repo('/r/solo', [tree('/r/solo', { kind: 'main' })]),
    ],
  })
  gitFacts.set('/r/app', {
    base: 'origin/main',
    trees: [gitTree('/r/app-wt-done', { merged: true }), gitTree('/r/app-wt-wip', { merged: true, dirty: true }), gitTree('/r/app-wt-shipped')],
  })
  gitFacts.set('/r/web', { base: 'main', trees: [gitTree('/r/web-wt-old')] })
}

describe('the cleanup view', () => {
  test('opening scans every repo with more than its main checkout and lists the stale ones, nothing selected', async () => {
    twoRepos()
    openCleanup()
    expect(cleanup()).toMatchObject({ open: true, step: 'list', scanning: true })
    await flush()
    expect(cleanupFacts.calls).toEqual([['/r/app'], ['/r/web']])
    expect(cleanup().candidates.map((c) => c.path)).toEqual(['/r/app-wt-done', '/r/app-wt-shipped'])
    expect(cleanup()).toMatchObject({ scanning: false, kept: '1 with changes · 1 not merged', errors: [] })
    expect(cleanup().selected.size).toBe(0)
  })

  test('a repo git cannot be asked about says so and the rest still list', async () => {
    twoRepos()
    gitFacts.set('/r/web', 'fatal: not a git repository')
    await scanCleanup()
    expect(cleanup().errors).toEqual(['web: fatal: not a git repository'])
    expect(cleanup().candidates).toHaveLength(2)
  })

  test('a scan answered after a newer one, or after closing, is dropped', async () => {
    twoRepos()
    const first = scanCleanup()
    gitFacts.set('/r/app', { base: 'origin/main', trees: [gitTree('/r/app-wt-done'), gitTree('/r/app-wt-shipped')] })
    const second = scanCleanup()
    await Promise.all([first, second])
    expect(cleanup().candidates.map((c) => c.path)).toEqual(['/r/app-wt-shipped'])
    gitFacts.set('/r/app', { base: 'origin/main', trees: [gitTree('/r/app-wt-done', { merged: true }), gitTree('/r/app-wt-shipped')] })
    const late = scanCleanup()
    closeCleanup()
    await late
    expect(cleanup()).toMatchObject({ open: false, scanning: false })
    expect(cleanup().candidates.map((c) => c.path)).toEqual(['/r/app-wt-shipped'])
  })

  test('select all, none, one; a rescan keeps only rows still listed', async () => {
    twoRepos()
    await scanCleanup()
    selectAll(true)
    expect([...cleanup().selected]).toEqual(['/r/app-wt-done', '/r/app-wt-shipped'])
    selectAll(false)
    toggleSelected('/r/app-wt-done')
    toggleSelected('/r/app-wt-shipped')
    toggleSelected('/r/app-wt-shipped')
    expect([...cleanup().selected]).toEqual(['/r/app-wt-done'])
    gitFacts.set('/r/app', { base: 'origin/main', trees: [gitTree('/r/app-wt-done', { dirty: true })] })
    await scanCleanup()
    expect(cleanup().selected.size).toBe(0)
  })

  test('confirming asks nothing with an empty selection', async () => {
    twoRepos()
    await scanCleanup()
    confirmCleanup()
    expect(cleanup().step).toBe('list')
    toggleSelected('/r/app-wt-done')
    confirmCleanup()
    expect(cleanup().step).toBe('confirm')
  })

  test('the batch removes one at a time, never forced, closes each one’s panes, and refreshes once', async () => {
    twoRepos()
    await scanCleanup()
    selectAll(true)
    confirmCleanup()
    const order: string[] = []
    removeWorktree.impl = async (path) => void order.push(`remove ${path}`)
    layoutStore.setState({ closeWorktree: vi.fn(async (path: string) => void order.push(`close ${path}`)) })
    const refresh = vi.fn(async () => {
      order.push('refresh')
      expect([...archiveStore.getState().removing]).toEqual(['/r/app-wt-done', '/r/app-wt-shipped'])
    })
    fleetStore.setState({ refresh })
    const run = removeSelected()
    expect(cleanup().progress).toEqual({ done: 0, failed: 0, total: 2 })
    await run
    expect(order).toEqual(['remove /r/app-wt-done', 'close /r/app-wt-done', 'remove /r/app-wt-shipped', 'close /r/app-wt-shipped', 'refresh'])
    expect(removeWorktree.calls).toEqual([
      ['/r/app-wt-done', false],
      ['/r/app-wt-shipped', false],
    ])
    expect(cleanup()).toMatchObject({ step: 'list', progress: null, candidates: [], failures: {} })
    expect(archiveStore.getState().removing.size).toBe(0)
    expect(toast.success).toHaveBeenCalledWith('Removed 2 workspaces', { description: 'Their branches are kept.' })
  })

  test('one git refuses stays listed and selected, saying why; its panes stay open', async () => {
    twoRepos()
    await scanCleanup()
    selectAll(true)
    confirmCleanup()
    refusals.set('/r/app-wt-done', "fatal: '/r/app-wt-done' contains modified or untracked files, use --force to delete it")
    await removeSelected()
    expect(cleanup().candidates.map((c) => c.path)).toEqual(['/r/app-wt-done'])
    expect([...cleanup().selected]).toEqual(['/r/app-wt-done'])
    expect(cleanup().failures['/r/app-wt-done']).toContain('contains modified or untracked files')
    expect(layoutStore.getState().closeWorktree).toHaveBeenCalledTimes(1)
    expect(layoutStore.getState().closeWorktree).toHaveBeenCalledWith('/r/app-wt-shipped')
    expect(toast.error).toHaveBeenCalledWith('Removed 1 of 2 workspaces', expect.anything())
  })
})

describe('a card’s Remove workspace', () => {
  function one(more: Parameters<typeof tree>[1] = {}, git: Partial<ReturnType<typeof gitTree>> = {}) {
    const t = tree('/r/app-wt-x', { branch: 'feat/x', ...more })
    fleetStore.setState({ repos: [repo('/r/app', [tree('/r/app', { kind: 'main' }), t])] })
    gitFacts.set('/r/app', { base: 'origin/main', trees: [gitTree('/r/app-wt-x', git)] })
    return t
  }

  test('a clean tree with no agent at work goes at once, unforced, and says its branch is kept', async () => {
    const t = one({ agents: [agent('a', 'done')] })
    let release!: () => void
    fleetStore.setState({ refresh: vi.fn(() => new Promise<void>((r) => (release = r))) })
    const pending = requestRemove(t)
    await flush()
    // Its card says "Removing…" until the fleet has dropped it.
    expect(archiveStore.getState().removing.has(t.path)).toBe(true)
    release()
    await pending
    expect(listWorktrees.calls).toEqual([['/r/app-wt-x']])
    expect(removeWorktree.calls).toEqual([['/r/app-wt-x', false]])
    expect(layoutStore.getState().closeWorktree).toHaveBeenCalledWith('/r/app-wt-x')
    expect(fleetStore.getState().refresh).toHaveBeenCalled()
    expect(archiveStore.getState()).toMatchObject({ ask: null })
    expect(archiveStore.getState().removing.size).toBe(0)
    expect(toast.success).toHaveBeenCalledWith('Removed app-wt-x', { description: 'Branch feat/x is kept.' })
  })

  test('changes ask first; yes forces past them', async () => {
    const t = one({}, { dirty: true })
    await requestRemove(t)
    expect(archiveStore.getState().ask).toEqual({ path: t.path, name: 'app-wt-x', branch: 'feat/x', dirty: true, live: 0 })
    expect(removeWorktree.calls).toEqual([])
    await answerRemove(true)
    expect(removeWorktree.calls).toEqual([['/r/app-wt-x', true]])
    expect(archiveStore.getState().ask).toBeNull()
  })

  test('agents at work ask first; yes removes without forcing a clean tree; no leaves it', async () => {
    const t = one({ agents: [agent('a', 'working'), agent('b', 'needs-you')] })
    await requestRemove(t)
    expect(archiveStore.getState().ask).toMatchObject({ dirty: false, live: 2 })
    await answerRemove(false)
    expect(archiveStore.getState().ask).toBeNull()
    expect(removeWorktree.calls).toEqual([])
    await requestRemove(t)
    await answerRemove(true)
    expect(removeWorktree.calls).toEqual([['/r/app-wt-x', false]])
  })

  test('the main checkout is never removed', async () => {
    await requestRemove(tree('/r/app', { kind: 'main' }))
    expect(listWorktrees.calls).toEqual([])
    expect(removeWorktree.calls).toEqual([])
  })

  test('a refusal is a toast, and the tree’s panes stay open', async () => {
    const t = one()
    refusals.set(t.path, 'setup is still running in /r/app-wt-x')
    await requestRemove(t)
    expect(toast.error).toHaveBeenCalledWith('Could not remove app-wt-x', { description: 'setup is still running in /r/app-wt-x' })
    expect(layoutStore.getState().closeWorktree).not.toHaveBeenCalled()
    expect(archiveStore.getState().removing.size).toBe(0)
  })

  test('a tree git does not list is not removed', async () => {
    const t = one()
    gitFacts.clear()
    await requestRemove(t)
    expect(removeWorktree.calls).toEqual([])
    expect(toast.error).toHaveBeenCalledWith('Could not remove app-wt-x', { description: 'git does not list /r/app-wt-x as a worktree' })
  })
})

describe('a repo header’s Forget project', () => {
  test('forgets it through Home and refreshes the fleet', async () => {
    await forgetRepo({ root: '/r/app', name: 'app' })
    expect(forgetProject.calls).toEqual([['/r/app']])
    expect(fleetStore.getState().refresh).toHaveBeenCalled()
  })

  test('a failure is a toast', async () => {
    forgetProject.impl = async () => {
      throw 'settings are read-only'
    }
    await forgetRepo({ root: '/r/app', name: 'app' })
    expect(toast.error).toHaveBeenCalledWith('Could not forget app', { description: 'settings are read-only' })
    expect(fleetStore.getState().refresh).not.toHaveBeenCalled()
  })
})
