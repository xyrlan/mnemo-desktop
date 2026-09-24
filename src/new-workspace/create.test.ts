import type { WorktreeInfo } from '../worktrees/client'
import { claudeCommand, createWorkspace, defaultName, issuePrompt, nameForIssue, treePath, workspaceName, type CreateDeps } from './create'

const tree = (over: Partial<WorktreeInfo> = {}): WorktreeInfo => ({
  path: '/gh/app-wt-a',
  branch: 'a',
  head: 'f'.repeat(40),
  isMain: false,
  dispatched: false,
  dirty: false,
  setupJob: null,
  ...over,
})

/** Deps that record every call, in order. */
function recorder(made: WorktreeInfo | Error = tree()) {
  const calls: unknown[][] = []
  const deps: CreateDeps = {
    async createWorktree(...a) {
      calls.push(['createWorktree', ...a])
      if (made instanceof Error) throw made
      return made
    },
    async switchWorktree(p) {
      calls.push(['switchWorktree', p])
    },
    async openCommandTab(cwd, cmd) {
      calls.push(['openCommandTab', cwd, cmd])
    },
    saveSetup: (repo, s) => void calls.push(['saveSetup', repo, s]),
    async listenSetup() {
      calls.push(['listenSetup'])
    },
    trackSetup: (job, t) => void calls.push(['trackSetup', job, t]),
    refresh: () => void calls.push(['refresh']),
  }
  return { deps, calls }
}

const input = { repo: '/gh/app', name: 'a', base: '', setup: '', skipPermissions: true }

test('a typed name becomes one branch-safe path segment', () => {
  expect(workspaceName('  fix the  login ')).toBe('fix-the-login')
  expect(workspaceName('feat/x')).toBe('featx')
  expect(workspaceName('../..')).toBe('')
  expect(workspaceName('-.a..b--c.')).toBe('a.b-c')
  expect(workspaceName('topic.lock')).toBe('topic')
  expect(workspaceName('ação')).toBe('ao')
  expect(workspaceName('x'.repeat(80))).toHaveLength(60)
  expect(workspaceName(`${'y'.repeat(59)}-z`)).toBe('y'.repeat(59))
})

test('an issue names its workspace by number and title, cut at a word', () => {
  expect(nameForIssue({ number: 42, title: 'Fix the login loop!' })).toBe('42-fix-the-login-loop')
  expect(nameForIssue({ number: 7, title: '🚀' })).toBe('issue-7')
  const long = nameForIssue({ number: 1, title: 'one two three four five six seven eight nine ten eleven' })
  expect(long.length).toBeLessThanOrEqual(43)
  expect(long).toBe('1-one-two-three-four-five-six-seven-eight')
  expect(workspaceName(long)).toBe(long)
})

test('the default name is the first workspace-N not taken', () => {
  expect(defaultName([])).toBe('workspace-1')
  expect(defaultName(['workspace-1', 'workspace-3', 'main'])).toBe('workspace-2')
})

test('the tree is the sibling <repo>-wt-<name>', () => {
  expect(treePath('/gh/app', 'a')).toBe('/gh/app-wt-a')
  expect(treePath('/gh/app/', 'a')).toBe('/gh/app-wt-a')
})

test('claude skips permissions only when asked, and takes an issue as a quoted prompt', () => {
  expect(claudeCommand(true)).toBe('claude --dangerously-skip-permissions')
  expect(claudeCommand(false)).toBe('claude')
  expect(claudeCommand(false, { number: 3, title: 'Crash' })).toBe('claude "Work on GitHub issue #3: Crash. Read it first with gh issue view 3."')
})

test('an issue prompt drops what a shell would expand or end the string on', () => {
  const p = issuePrompt({ number: 9, title: 'Use "$HOME" `x` \\ 100% ^ ok!\nnext' })
  expect(p).toBe('Work on GitHub issue #9: Use HOME x 100 ok next. Read it first with gh issue view 9.')
  expect(p).not.toMatch(/["`$\\!%^\n]/)
})

test('create makes the tree, then switches to it, then starts claude in it, then refreshes the fleet', async () => {
  const { deps, calls } = recorder()
  const made = await createWorkspace(deps, input)
  expect(made.path).toBe('/gh/app-wt-a')
  expect(calls).toEqual([
    ['saveSetup', '/gh/app', ''],
    ['createWorktree', '/gh/app', 'a', {}],
    ['switchWorktree', '/gh/app-wt-a'],
    ['openCommandTab', '/gh/app-wt-a', 'claude --dangerously-skip-permissions'],
    ['refresh'],
  ])
})

test('create passes base and setup, listens before creating, and tracks the setup job', async () => {
  const { deps, calls } = recorder(tree({ setupJob: 'worktree-setup:/gh/app-wt-a' }))
  await createWorkspace(deps, { ...input, name: 'my tree', base: ' main ', setup: ' pnpm install ', skipPermissions: false, issue: { number: 5, title: 'Go' } })
  expect(calls).toEqual([
    ['saveSetup', '/gh/app', 'pnpm install'],
    ['listenSetup'],
    ['createWorktree', '/gh/app', 'my-tree', { base: 'main', setup: 'pnpm install' }],
    ['trackSetup', 'worktree-setup:/gh/app-wt-a', { path: '/gh/app-wt-a', name: 'my-tree' }],
    ['switchWorktree', '/gh/app-wt-a'],
    ['openCommandTab', '/gh/app-wt-a', `claude "${issuePrompt({ number: 5, title: 'Go' })}"`],
    ['refresh'],
  ])
})

test('a refused tree rejects with the reason and switches to nothing', async () => {
  const { deps, calls } = recorder(new Error('branch a is checked out elsewhere'))
  await expect(createWorkspace(deps, input)).rejects.toThrow('branch a is checked out elsewhere')
  expect(calls.map((c) => c[0])).toEqual(['saveSetup', 'createWorktree'])
})

test('a name with nothing usable in it is refused before anything happens', async () => {
  const { deps, calls } = recorder()
  await expect(createWorkspace(deps, { ...input, name: '///' })).rejects.toThrow(/Name the workspace/)
  expect(calls).toEqual([])
})
