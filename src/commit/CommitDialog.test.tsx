import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Change, Status } from './client'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// `invoke` is a plain recorder (a vi.fn() rejecting with a string fails the test under vitest 5):
// each command answers from `ipc.answers`, a function so a test can refuse with a string or hold
// its answer back with a promise.
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
const toasts = vi.hoisted(() => [] as [string, string, string?][])
vi.mock('sonner', async (original) => ({
  ...(await original<typeof import('sonner')>()),
  toast: {
    success: (title: string) => void toasts.push(['success', title]),
    error: (title: string, opts?: { description?: string }) => void toasts.push(['error', title, opts?.description]),
  },
}))

import { tauriCommit } from './client'
import CommitComposer from './CommitDialog'
import { closeCommit, openCommit } from './open'

const WT = '/code/app-wt-feat'
const change = (path: string, over: Partial<Change> = {}): Change => ({ path, origPath: null, index: '.', worktree: 'M', conflicted: false, ...over })
const STATUS: Status = {
  root: WT,
  branch: 'feat',
  remote: 'origin',
  published: true,
  ahead: 0,
  behind: 0,
  base: 'main',
  unborn: false,
  changes: [change('src/a.ts'), change('notes.md', { index: '?', worktree: '?' }), change('src/gone.ts', { index: '.', worktree: 'D' })],
}
const status = (over: Partial<Status> = {}): Status => ({ ...STATUS, ...over })

const deferred = <T,>() => {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)))
  return { promise, resolve, reject }
}

let root: Root
const opened: [string, string][] = []

beforeEach(async () => {
  ipc.calls = []
  toasts.length = 0
  opened.length = 0
  ipc.answers = {
    commit_status: () => STATUS,
    commit_pr_find: () => null,
    commit_message: () => 'feat: the change',
    commit_create: () => ({ sha: 'abc1234', summary: 'feat: the change' }),
    commit_push: () => 'Pushed feat to origin',
  }
  root = createRoot(document.body.appendChild(document.createElement('div')))
  await act(async () => root.render(<CommitComposer client={tauriCommit} onOpenUrl={(url, title) => void opened.push([url, title])} />))
})

afterEach(async () => {
  await act(async () => closeCommit())
  await act(async () => root.unmount())
  document.body.innerHTML = ''
})

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')
const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text || b.getAttribute('aria-label') === text) as HTMLButtonElement | undefined
const alerts = () => [...document.querySelectorAll<HTMLElement>('[role="alert"]')].map((a) => a.textContent)
const done = () => [...document.querySelectorAll<HTMLElement>('[role="status"]')].map((a) => a.textContent)
const called = (cmd: string) => ipc.calls.filter(([c]) => c === cmd).map(([, a]) => a)
const rows = () => [...dialog()!.querySelectorAll('li')]
const listed = () => rows().map((r) => r.querySelector('label')!.title)
const boxes = () => rows().map((r) => r.querySelector('input')!)
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
  await act(async () => openCommit(WT))
  await settle()
}

describe('what it commits', () => {
  it('sends exactly the picked paths and the message as written, and says done only once git answered', async () => {
    const answer = deferred<unknown>()
    ipc.answers.commit_create = () => answer.promise
    await open()
    expect(listed()).toEqual(['src/a.ts', 'notes.md', 'src/gone.ts'])
    await click(boxes()[1])
    await type(messageBox()!, 'fix: the dialog\n\n#283 asked for it')
    await click(button('Commit')!)
    expect(called('commit_create')).toEqual([{ worktree: WT, paths: ['src/a.ts', 'src/gone.ts'], message: 'fix: the dialog\n\n#283 asked for it' }])
    // In flight: nothing claims success, and nothing can be changed under it.
    expect(done()).toEqual([])
    expect(messageBox()!.disabled).toBe(true)
    expect(boxes().every((b) => b.disabled)).toBe(true)
    expect(button('Commit')!.disabled).toBe(true)

    await act(async () => answer.resolve({ sha: 'abc1234', summary: 'fix: the dialog' }))
    await settle()
    expect(done()).toEqual(['Committed abc1234 fix: the dialog'])
    expect(alerts()).toEqual([])
    expect(messageBox()!.value).toBe('')
  })

  it('pushes only after the commit went in, and a refused push is shown beside the commit', async () => {
    ipc.answers.commit_push = () => {
      throw 'git push: ! [rejected] feat -> feat (fetch first)'
    }
    await open()
    await type(messageBox()!, 'feat: both')
    await click(button('Commit & Push')!)
    await settle()
    expect(ipc.calls.map(([c]) => c).filter((c) => c === 'commit_create' || c === 'commit_push')).toEqual(['commit_create', 'commit_push'])
    expect(done()).toEqual(['Committed abc1234 feat: the change'])
    expect(alerts()).toEqual(['Push failedgit push: ! [rejected] feat -> feat (fetch first)'])
  })
})

describe('an empty message', () => {
  it('cannot be committed: not by the buttons, not by the keyboard', async () => {
    await open()
    expect(button('Commit')!.disabled).toBe(true)
    expect(button('Commit')!.title).toBe('Write a message first')
    expect(button('Commit & Push')!.disabled).toBe(true)
    await type(messageBox()!, '  \n\t ')
    expect(button('Commit')!.disabled).toBe(true)
    await act(async () => void messageBox()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true })))
    await settle()
    expect(called('commit_create')).toEqual([])
  })
})

describe('nothing to commit', () => {
  it('a clean tree says so and offers no message or commit', async () => {
    ipc.answers.commit_status = () => status({ changes: [] })
    await open()
    expect(dialog()!.textContent).toContain('No changes to commit.')
    expect(messageBox()).toBeNull()
    expect(button('Commit')!.disabled).toBe(true)
  })

  it('with every file unpicked, Commit says to pick one', async () => {
    await open()
    await type(messageBox()!, 'fix: x')
    await click(dialog()!.querySelector<HTMLInputElement>('input[aria-label="Pick every change"]')!)
    expect(dialog()!.textContent).toContain('0 of 3 picked')
    expect(button('Commit')!.disabled).toBe(true)
    expect(button('Commit')!.title).toBe('Pick at least one file')
  })
})

describe('a failing hook', () => {
  it.each([
    ['pre-commit', 'git commit: husky - pre-commit hook exited with code 1\nlint: 3 problems'],
    ['commit-msg', 'git commit: subject must start with a type'],
  ])('a refusing %s hook is shown as it said it, with the message kept and nothing claimed', async (_hook, said) => {
    ipc.answers.commit_create = () => {
      throw said
    }
    await open()
    await type(messageBox()!, 'my message')
    await click(button('Commit & Push')!)
    await settle()
    expect(alerts()).toEqual([`Commit failed${said}`])
    expect(done()).toEqual([])
    expect(messageBox()!.value).toBe('my message')
    expect(called('commit_push')).toEqual([])
    // It can be tried again once fixed.
    expect(button('Commit')!.disabled).toBe(false)
  })
})

describe('a detached HEAD', () => {
  it('names it, commits, and does not offer to push or open a PR', async () => {
    ipc.answers.commit_status = () => status({ branch: null, published: false })
    await open()
    expect(document.querySelector('[role="dialog"] h2')!.textContent).toBe('Commit')
    expect(dialog()!.textContent).toContain('detached HEAD')
    expect(button('Publish branch')!.disabled).toBe(true)
    expect(button('Publish branch')!.title).toBe('Check out a branch to push')
    await type(messageBox()!, 'fix: detached')
    expect(button('Commit & Push')!.disabled).toBe(true)
    expect(button('Commit & Push')!.title).toBe('Check out a branch to push')
    expect(button('Create PR…')!.disabled).toBe(true)
    await click(button('Commit')!)
    await settle()
    expect(done()).toEqual(['Committed abc1234 feat: the change'])
  })

  it('says detached HEAD even when the repo has no remote', async () => {
    ipc.answers.commit_status = () => status({ branch: null, remote: null, published: false })
    await open()
    expect(dialog()!.textContent).toContain('detached HEAD · no remote')
  })
})

describe('a merge in progress', () => {
  it('keeps a conflicted file unpickable, and shows how to finish when git refuses the commit', async () => {
    const said = 'git commit: fatal: cannot do a partial commit during a merge.\nA merge is in progress: finish it in a terminal with `git commit`, or abort it with `git merge --abort`.'
    ipc.answers.commit_status = () => status({ changes: [change('both.ts', { index: 'U', worktree: 'U', conflicted: true }), change('side.ts', { index: 'A', worktree: '.' })] })
    ipc.answers.commit_create = () => {
      throw said
    }
    await open()
    expect(boxes().map((b) => [b.checked, b.disabled])).toEqual([
      [false, true],
      [true, false],
    ])
    expect(rows()[0].querySelector('label')!.title).toBe('Resolve the conflict before committing this file')
    await type(messageBox()!, 'merge side')
    await click(button('Commit')!)
    await settle()
    expect(called('commit_create')).toEqual([{ worktree: WT, paths: ['side.ts'], message: 'merge side' }])
    expect(alerts()).toEqual([`Commit failed${said}`])
    expect(done()).toEqual([])
  })
})

describe('files changed on disk while it is open', () => {
  it('every open reads the worktree again', async () => {
    await open()
    expect(listed()).toEqual(['src/a.ts', 'notes.md', 'src/gone.ts'])
    await act(async () => closeCommit())
    expect(dialog()).toBeNull()
    ipc.answers.commit_status = () => status({ changes: [change('src/b.ts')] })
    await open()
    expect(listed()).toEqual(['src/b.ts'])
    expect(called('commit_status')).toHaveLength(2)
  })

  it('a refused commit of a file gone stale reads the list again, keeping the other picks', async () => {
    ipc.answers.commit_create = () => {
      throw 'src/gone.ts changed on disk since the list was read: no changes to commit there any more.'
    }
    await open()
    await click(boxes()[1])
    await type(messageBox()!, 'fix: a')
    ipc.answers.commit_status = () => status({ changes: [change('src/a.ts'), change('notes.md', { index: '?', worktree: '?' })] })
    await click(button('Commit')!)
    await settle()
    expect(alerts()).toEqual(['Commit failedsrc/gone.ts changed on disk since the list was read: no changes to commit there any more.'])
    expect(listed()).toEqual(['src/a.ts', 'notes.md'])
    expect(boxes().map((b) => b.checked)).toEqual([true, false])

    ipc.answers.commit_create = () => ({ sha: 'def5678', summary: 'fix: a' })
    await click(button('Commit')!)
    await settle()
    expect(called('commit_create')[1]).toEqual({ worktree: WT, paths: ['src/a.ts'], message: 'fix: a' })
    expect(alerts()).toEqual([])
    expect(done()).toEqual(['Committed def5678 fix: a'])
  })

  it('a file that appears after a commit is listed before the next one', async () => {
    await open()
    await type(messageBox()!, 'feat: first')
    ipc.answers.commit_status = () => status({ changes: [change('src/new.ts', { index: '?', worktree: '?' })] })
    await click(button('Commit')!)
    await settle()
    expect(listed()).toEqual(['src/new.ts'])
  })
})

describe('closed before git answered', () => {
  it('tells the commit and the push that followed as toasts', async () => {
    const answer = deferred<unknown>()
    ipc.answers.commit_create = () => answer.promise
    await open()
    await type(messageBox()!, 'feat: x')
    await click(button('Commit & Push')!)
    await act(async () => closeCommit())
    expect(dialog()).toBeNull()
    await act(async () => answer.resolve({ sha: 'abc1234', summary: 'feat: x' }))
    await settle()
    expect(toasts).toEqual([
      ['success', 'Committed abc1234 feat: x'],
      ['success', 'Pushed feat to origin'],
    ])
  })

  it('tells a hook refusal as an error toast, not silence', async () => {
    const answer = deferred<unknown>()
    ipc.answers.commit_create = () => answer.promise
    await open()
    await type(messageBox()!, 'feat: x')
    await click(button('Commit')!)
    await act(async () => closeCommit())
    await act(async () => answer.reject('git commit: lint: 3 problems'))
    await settle()
    expect(toasts).toEqual([['error', 'Commit failed', 'git commit: lint: 3 problems']])
  })

  it('a close with nothing under way tells nothing', async () => {
    await open()
    await act(async () => closeCommit())
    await settle()
    expect(toasts).toEqual([])
  })
})
