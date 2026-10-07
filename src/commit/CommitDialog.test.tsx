import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Change, Status } from './client'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// `invoke` is a plain recorder (a vi.fn() rejecting with a string fails the test under vitest 5):
// each command answers from `ipc.answers`, a function so a test can refuse with a string, as
// `commit.rs` does with what git said.
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

import CommitComposer from './CommitDialog'
import { tauriCommit } from './client'
import { closeCommit, openCommit } from './open'

const change = (path: string, over: Partial<Change> = {}): Change => ({ path, origPath: null, index: '.', worktree: 'M', conflicted: false, ...over })

const status = (over: Partial<Status> = {}): Status => ({
  root: '/code/app',
  branch: 'feat',
  remote: 'origin',
  published: true,
  ahead: 0,
  behind: 0,
  base: 'main',
  unborn: false,
  merging: false,
  changes: [change('src/a.ts'), change('notes.md', { index: '?', worktree: '?' })],
  ...over,
})

beforeAll(async () => {
  await act(async () => {
    createRoot(document.body.appendChild(document.createElement('div'))).render(<CommitComposer client={tauriCommit} onOpenUrl={() => {}} />)
  })
})

beforeEach(() => {
  ipc.calls = []
  ipc.answers = {
    commit_status: () => status(),
    commit_pr_find: () => null,
    commit_create: () => ({ sha: 'abc1234', summary: 'feat: the change' }),
    commit_push: () => 'Pushed feat to origin',
  }
})

afterEach(async () => {
  await act(async () => closeCommit())
})

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!
const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(text)) as HTMLButtonElement | undefined
const alerts = () => [...document.querySelectorAll<HTMLElement>('[role="alert"]')].map((a) => a.textContent)
const done = () => [...document.querySelectorAll<HTMLElement>('[role="status"]')].map((a) => a.textContent)
const called = (cmd: string) => ipc.calls.filter(([c]) => c === cmd).map(([, a]) => a)
const rows = () => [...dialog().querySelectorAll('li')].map((r) => [r.querySelector('span > span')!.textContent, r.querySelector('input')!.checked])
const messageBox = () => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Commit message"]')
const click = (el: HTMLElement) => act(async () => el.click())
const settle = () => act(async () => await new Promise((r) => setTimeout(r, 0)))

async function type(el: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function open() {
  await act(async () => openCommit('/code/app'))
  await settle()
}

describe('the message', () => {
  it('is required: an empty or blank one cannot commit, by button or by keys', async () => {
    await open()
    expect(button('Commit')!.disabled).toBe(true)
    expect(button('Commit')!.title).toBe('Write a message first')
    await type(messageBox()!, '  \n\t ')
    expect(button('Commit')!.disabled).toBe(true)
    expect(button('Commit & Push')!.disabled).toBe(true)
    await act(async () => void messageBox()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true })))
    await settle()
    expect(called('commit_create')).toEqual([])
  })

  it('goes to git as typed, and the notice shows what git recorded', async () => {
    ipc.answers.commit_create = () => ({ sha: 'def5678', summary: '#283 fix it' })
    await open()
    await type(messageBox()!, '#283 fix it\n\n# not a comment')
    await click(button('Commit')!)
    await settle()
    expect(called('commit_create')).toEqual([{ worktree: '/code/app', paths: ['src/a.ts', 'notes.md'], message: '#283 fix it\n\n# not a comment' }])
    expect(done()).toEqual(['Committed def5678 #283 fix it'])
  })
})

describe('what is committed', () => {
  it('is the picked rows on screen, nothing else', async () => {
    ipc.answers.commit_status = () => status({ changes: [change('src/a.ts'), change('src/b.ts', { index: 'M', worktree: '.' }), change('both.ts', { index: 'U', worktree: 'U', conflicted: true })] })
    await open()
    expect(rows()).toEqual([
      ['a.ts', true],
      ['b.ts', true],
      ['both.ts', false],
    ])
    await click(dialog().querySelectorAll<HTMLInputElement>('li input')[0])
    await type(messageBox()!, 'fix: b only')
    await click(button('Commit')!)
    await settle()
    expect(called('commit_create')).toEqual([{ worktree: '/code/app', paths: ['src/b.ts'], message: 'fix: b only' }])
  })

  it('says nothing about success until git has answered', async () => {
    let answer!: (v: unknown) => void
    ipc.answers.commit_create = () => new Promise((r) => (answer = r))
    await open()
    await type(messageBox()!, 'fix: slow hook')
    await click(button('Commit')!)
    await settle()
    expect(done()).toEqual([])
    expect(button('Commit')!.disabled).toBe(true)
    await act(async () => answer({ sha: 'abc1234', summary: 'fix: slow hook' }))
    await settle()
    expect(done()).toEqual(['Committed abc1234 fix: slow hook'])
  })
})

describe('nothing to commit', () => {
  it('says so and offers no commit', async () => {
    ipc.answers.commit_status = () => status({ changes: [] })
    await open()
    expect(dialog().textContent).toContain('No changes to commit.')
    expect(messageBox()).toBeNull()
    expect(button('Commit')!.disabled).toBe(true)
    expect(button('Commit & Push')!.disabled).toBe(true)
    expect(button('Commit')!.title).toBe('Pick at least one file')
  })

  it('with nothing picked, offers no commit', async () => {
    await open()
    await click(dialog().querySelector<HTMLInputElement>('input[aria-label="Pick every change"]')!)
    await type(messageBox()!, 'fix: it')
    expect(dialog().textContent).toContain('0 of 2 picked')
    expect(button('Commit')!.disabled).toBe(true)
    expect(button('Commit')!.title).toBe('Pick at least one file')
  })
})

describe('a refused commit', () => {
  for (const [hook, said] of [
    ['pre-commit', 'git commit: husky - pre-commit hook exited with code 1\nlint: 3 problems'],
    ['commit-msg', 'git commit: commitlint: subject may not be empty'],
  ]) {
    it(`shows what the ${hook} hook said, claims nothing, keeps the message and pushes nothing`, async () => {
      ipc.answers.commit_create = () => {
        throw said
      }
      await open()
      await type(messageBox()!, 'fix: it')
      await click(button('Commit & Push')!)
      await settle()
      expect(alerts()).toEqual([`Commit failed${said}`])
      expect(dialog().querySelector('[role="alert"] pre')!.textContent).toBe(said)
      expect(done()).toEqual([])
      expect(called('commit_push')).toEqual([])
      expect(messageBox()!.value).toBe('fix: it')
      expect(button('Commit')!.disabled).toBe(false)
    })
  }

  it('reads the changes again: a file gone since the dialog opened leaves the list', async () => {
    ipc.answers.commit_create = () => {
      throw "git add: fatal: pathspec 'notes.md' did not match any files"
    }
    await open()
    expect(rows()).toEqual([
      ['a.ts', true],
      ['notes.md', true],
    ])
    ipc.answers.commit_status = () => status({ changes: [change('src/a.ts')] })
    await type(messageBox()!, 'fix: it')
    await click(button('Commit')!)
    await settle()
    expect(alerts()).toEqual(["Commit failedgit add: fatal: pathspec 'notes.md' did not match any files"])
    expect(rows()).toEqual([['a.ts', true]])
    ipc.answers.commit_create = () => ({ sha: 'abc1234', summary: 'fix: it' })
    await click(button('Commit')!)
    await settle()
    expect(called('commit_create').at(-1)).toEqual({ worktree: '/code/app', paths: ['src/a.ts'], message: 'fix: it' })
    expect(alerts()).toEqual([])
  })
})

describe('a detached HEAD', () => {
  it('says so, commits where it is, and offers no push or PR', async () => {
    ipc.answers.commit_status = () => status({ branch: null, published: false })
    await open()
    expect(dialog().querySelector('h2')!.textContent).toBe('Commit')
    expect(dialog().textContent).toContain('detached HEAD')
    expect(button('Publish branch')!.disabled).toBe(true)
    expect(button('Publish branch')!.title).toBe('Check out a branch to push')
    expect(button('Create PR…')!.disabled).toBe(true)
    await type(messageBox()!, 'fix: detached')
    expect(button('Commit & Push')!.disabled).toBe(true)
    await click(button('Commit')!)
    await settle()
    expect(called('commit_create')).toHaveLength(1)
    expect(done()).toEqual(['Committed abc1234 feat: the change'])
  })

  it('says so with no remote too', async () => {
    ipc.answers.commit_status = () => status({ branch: null, remote: null, published: false })
    await open()
    expect(dialog().textContent).toContain('detached HEAD · no remote')
  })
})

describe('a merge in progress', () => {
  it('says so, and commits only with every change picked', async () => {
    ipc.answers.commit_status = () => status({ merging: true })
    await open()
    expect(dialog().textContent).toContain('merge in progress')
    await type(messageBox()!, 'Merge side')
    await click(dialog().querySelectorAll<HTMLInputElement>('li input')[1])
    expect(button('Commit')!.disabled).toBe(true)
    expect(button('Commit')!.title).toBe('A merge is committed whole: pick every change')
    await click(dialog().querySelectorAll<HTMLInputElement>('li input')[1])
    expect(button('Commit')!.disabled).toBe(false)
    await click(button('Commit')!)
    await settle()
    expect(called('commit_create')).toEqual([{ worktree: '/code/app', paths: ['src/a.ts', 'notes.md'], message: 'Merge side' }])
  })

  it('with a conflict left, offers no commit', async () => {
    ipc.answers.commit_status = () => status({ merging: true, changes: [change('src/a.ts'), change('both.ts', { index: 'U', worktree: 'U', conflicted: true })] })
    await open()
    await type(messageBox()!, 'Merge side')
    expect(button('Commit')!.disabled).toBe(true)
    expect(button('Commit')!.title).toBe('Resolve the conflicts first')
  })

  it('shows git refusing it, should the merge start after the dialog opened', async () => {
    const refusal = 'A merge is in progress, and git commits a merge whole: pick every change (notes.md left out).'
    ipc.answers.commit_create = () => {
      throw refusal
    }
    await open()
    ipc.answers.commit_status = () => status({ merging: true })
    await click(dialog().querySelectorAll<HTMLInputElement>('li input')[1])
    await type(messageBox()!, 'fix: it')
    await click(button('Commit')!)
    await settle()
    expect(alerts()).toEqual([`Commit failed${refusal}`])
    expect(dialog().textContent).toContain('merge in progress')
    expect(done()).toEqual([])
  })
})

describe('the worktree changing while the dialog is open', () => {
  it('every open reads it again; a commit reads it after', async () => {
    await open()
    expect(called('commit_status')).toHaveLength(1)
    ipc.answers.commit_status = () => status({ changes: [change('src/a.ts'), change('notes.md', { index: '?', worktree: '?' }), change('later.ts', { index: '?', worktree: '?' })] })
    // Open while it is open (the action again): it starts over, with the file made since.
    await open()
    expect(called('commit_status')).toHaveLength(2)
    expect(rows().map(([p]) => p)).toEqual(['a.ts', 'notes.md', 'later.ts'])
    await click(dialog().querySelectorAll<HTMLInputElement>('li input')[2])
    await type(messageBox()!, 'fix: it')
    ipc.answers.commit_status = () => status({ changes: [change('later.ts', { index: '?', worktree: '?' })] })
    await click(button('Commit')!)
    await settle()
    expect(called('commit_create')).toEqual([{ worktree: '/code/app', paths: ['src/a.ts', 'notes.md'], message: 'fix: it' }])
    expect(called('commit_status')).toHaveLength(3)
    // The path left out keeps its pick: unpicked.
    expect(rows()).toEqual([['later.ts', false]])
  })
})
