import { act } from 'react'
import type { Status } from './client'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// `invoke` is a plain recorder (a vi.fn() rejecting with a string fails the test under vitest 5):
// each command answers from `ipc.answers`, a function so a test can refuse with a string.
const ipc = vi.hoisted(() => ({
  calls: [] as [string, Record<string, unknown>][],
  answers: {} as Record<string, (args: Record<string, unknown>) => unknown>,
}))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
    ipc.calls.push([cmd, args])
    const answer = ipc.answers[cmd]
    if (!answer) throw `no answer for ${cmd}`
    return answer(args)
  },
}))
const opened: [string, string][] = []
vi.mock('../github/actions', () => ({ openUrl: (url: string, title: string) => void opened.push([url, title]) }))
vi.mock('../layout/app-store', async () => {
  const { createStore } = await import('zustand')
  const store = createStore(() => ({ activeWorktree: '/code/app-wt-feat' as string | null }))
  return { store, useApp: () => null }
})

import { all, run } from '../actions/registry'
import { store as layout } from '../layout/app-store'
import { closeCommit, commitOpenStore, openCommit } from './open'

const STATUS: Status = {
  root: '/code/app-wt-feat',
  branch: 'feat',
  remote: 'origin',
  published: false,
  ahead: 1,
  behind: 0,
  base: 'main',
  unborn: false,
  changes: [
    { path: 'src/a.ts', origPath: null, index: '.', worktree: 'M', conflicted: false },
    { path: 'notes.md', origPath: null, index: '?', worktree: '?', conflicted: false },
    { path: 'src/new.ts', origPath: 'src/old.ts', index: 'R', worktree: '.', conflicted: false },
  ],
}

function answerAll() {
  ipc.answers = {
    commit_status: () => STATUS,
    commit_pr_find: () => null,
    commit_message: () => 'feat: the change\n\nwhy it matters',
    commit_create: () => ({ sha: 'abc1234', summary: 'feat: the change' }),
    commit_push: () => 'Pushed feat to origin',
    commit_pr_draft: () => ({ title: 'The change', body: 'What and why.' }),
    commit_pr_create: () => ({ number: 42, url: 'https://github.com/o/app/pull/42', state: 'OPEN', title: 'The change' }),
  }
}

beforeAll(async () => {
  await act(async () => {
    await import('./view')
    const { SlotOutlet } = await import('../shell/Slot')
    const { createRoot } = await import('react-dom/client')
    createRoot(document.body.appendChild(document.createElement('div'))).render(<SlotOutlet slot="overlay" />)
  })
}, 60_000)

beforeEach(() => {
  ipc.calls = []
  opened.length = 0
  answerAll()
})

afterEach(async () => {
  await act(async () => closeCommit())
})

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')
const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(text) || b.getAttribute('aria-label') === text) as HTMLButtonElement | undefined
const alerts = () => [...document.querySelectorAll<HTMLElement>('[role="alert"]')].map((a) => a.textContent)
const called = (cmd: string) => ipc.calls.filter(([c]) => c === cmd).map(([, a]) => a)
const click = (el: HTMLElement) => act(async () => el.click())
const settle = () => act(async () => await new Promise((r) => setTimeout(r, 0)))

async function type(el: HTMLTextAreaElement | HTMLInputElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function openOn(worktree = '/code/app-wt-feat') {
  await act(async () => openCommit(worktree))
  await settle()
}

const messageBox = () => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Commit message"]')!

it('registers commit.open once, and it opens the composer on the worktree on screen', async () => {
  expect(all().filter((a) => a.id === 'commit.open')).toHaveLength(1)
  await act(async () => run('commit.open'))
  await settle()
  expect(commitOpenStore.getState().worktree).toBe('/code/app-wt-feat')
  expect(dialog()).not.toBeNull()
  expect(called('commit_status')).toEqual([{ worktree: '/code/app-wt-feat' }])
  expect(called('commit_pr_find')).toEqual([{ worktree: '/code/app-wt-feat' }])
})

it('with no worktree on screen, commit.open says so instead of opening', async () => {
  layout.setState({ activeWorktree: null })
  await act(async () => run('commit.open'))
  expect(commitOpenStore.getState().worktree).toBeNull()
  layout.setState({ activeWorktree: '/code/app-wt-feat' })
})

it('lists the changes, all picked, with what happened to each', async () => {
  await openOn()
  const rows = [...dialog()!.querySelectorAll('li')]
  expect(rows.map((r) => r.textContent)).toEqual(['a.tssrcM', 'notes.mdA', 'new.tssrcR'])
  expect(rows.map((r) => r.querySelector('input')!.checked)).toEqual([true, true, true])
  expect(rows[2].querySelector('[title^="Renamed"]')!.getAttribute('title')).toBe('Renamed from src/old.ts')
  expect(dialog()!.textContent).toContain('3 of 3 picked')
  expect(dialog()!.textContent).toContain('not on origin yet')
})

it('writes the message with AI for the picked files, then commits them', async () => {
  await openOn()
  await click(dialog()!.querySelectorAll<HTMLInputElement>('li input')[1])
  expect(dialog()!.textContent).toContain('2 of 3 picked')
  expect(button('Commit')!.disabled).toBe(true)

  await click(button('Write the commit message with AI')!)
  await settle()
  expect(called('commit_message')).toEqual([{ worktree: '/code/app-wt-feat', paths: ['src/a.ts', 'src/new.ts'] }])
  expect(messageBox().value).toBe('feat: the change\n\nwhy it matters')

  await type(messageBox(), 'feat: edited by hand')
  await click(button('Commit')!)
  await settle()
  expect(called('commit_create')).toEqual([{ worktree: '/code/app-wt-feat', paths: ['src/a.ts', 'src/new.ts'], message: 'feat: edited by hand' }])
  expect(dialog()!.textContent).toContain('Committed abc1234 feat: the change')
  expect(called('commit_status')).toHaveLength(2)
})

it('commits from the keyboard with Mod+Enter', async () => {
  await openOn()
  await type(messageBox(), 'fix: keys')
  await act(async () => void messageBox().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true })))
  await settle()
  expect(called('commit_create')).toHaveLength(1)
})

it('shows every failure as its program said it', async () => {
  ipc.answers.commit_message = () => {
    throw 'claude: Invalid API key'
  }
  ipc.answers.commit_create = () => {
    throw 'git commit: husky - pre-commit hook exited with code 1'
  }
  ipc.answers.commit_push = () => {
    throw 'git push: fatal: could not read Username'
  }
  await openOn()
  await click(button('Write the commit message with AI')!)
  await settle()
  await type(messageBox(), 'x')
  await click(button('Commit')!)
  await settle()
  await click(button('Publish branch')!)
  await settle()
  expect(alerts()).toEqual([
    'The message could not be writtenclaude: Invalid API key',
    'Commit failedgit commit: husky - pre-commit hook exited with code 1',
    'Push failedgit push: fatal: could not read Username',
  ])
  await click(button('Dismiss')!)
  expect(alerts()).toHaveLength(2)
})

it('shows a folder that cannot be read', async () => {
  ipc.answers.commit_status = () => {
    throw 'git rev-parse: fatal: not a git repository'
  }
  await openOn('/tmp/nowhere')
  expect(alerts()).toEqual(['Could not read the changesgit rev-parse: fatal: not a git repository'])
})

it('commit and push commits, then pushes', async () => {
  await openOn()
  await type(messageBox(), 'feat: both')
  await click(button('Commit & Push')!)
  await settle()
  expect(ipc.calls.map(([c]) => c).filter((c) => c === 'commit_create' || c === 'commit_push')).toEqual(['commit_create', 'commit_push'])
  expect(dialog()!.textContent).toContain('Pushed feat to origin')
})

it('creates a PR with a drafted title and body, pushing first, and links it', async () => {
  await openOn()
  await click(button('Create PR…')!)
  await settle()
  expect(called('commit_pr_draft')).toEqual([{ worktree: '/code/app-wt-feat', base: 'main' }])
  const title = document.querySelector<HTMLInputElement>('input[aria-label="Pull request title"]')!
  const body = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Pull request description"]')!
  expect(title.value).toBe('The change')
  expect(body.value).toBe('What and why.')
  expect(dialog()!.textContent).toContain('Pushes the branch first.')
  await type(body, 'Edited body.')
  await click(button('Create pull request')!)
  await settle()
  expect(called('commit_push')).toHaveLength(1)
  expect(called('commit_pr_create')).toEqual([{ worktree: '/code/app-wt-feat', base: 'main', title: 'The change', body: 'Edited body.', draft: false }])
  await click(button('PR #42')!)
  expect(opened).toEqual([['https://github.com/o/app/pull/42', 'PR #42']])
})

it('offers the open PR instead of creating another', async () => {
  ipc.answers.commit_pr_find = () => ({ number: 9, url: 'https://github.com/o/app/pull/9', state: 'OPEN', title: 'Earlier' })
  await openOn()
  expect(button('Create PR…')).toBeUndefined()
  await click(button('PR #9')!)
  expect(opened[0]).toEqual(['https://github.com/o/app/pull/9', 'PR #9'])
})

it('opening again starts over with a fresh read', async () => {
  await openOn()
  await type(messageBox(), 'draft')
  await openOn()
  expect(messageBox().value).toBe('')
  expect(called('commit_status')).toHaveLength(2)
})

it('says there is nothing to commit on a clean tree', async () => {
  ipc.answers.commit_status = () => ({ ...STATUS, published: true, ahead: 0, changes: [] })
  await openOn()
  expect(dialog()!.textContent).toContain('No changes to commit.')
  expect(document.querySelector('textarea[aria-label="Commit message"]')).toBeNull()
  expect(button('Push')!.disabled).toBe(true)
})
