import type { Change, CommitClient, PullRequest, Status } from './client'
import { createCommitStore, said } from './store'

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
  changes: [change('a.ts'), change('b.ts'), change('c.ts', { conflicted: true, index: 'U', worktree: 'U' })],
  ...over,
})

/** A client whose every answer comes from `answers`, and whose calls are recorded. Answers are
 *  functions so a test can change them between calls; a string thrown is how Tauri refuses. */
function fake(answers: Partial<Record<keyof CommitClient, (...args: never[]) => unknown>> = {}) {
  const calls: [string, ...unknown[]][] = []
  const defaults: Record<keyof CommitClient, (...args: never[]) => unknown> = {
    status: () => status(),
    message: () => 'feat: do it',
    commit: () => ({ sha: 'abc1234', summary: 'feat: do it' }),
    push: () => 'Pushed feat to origin',
    findPr: () => null,
    draftPr: () => ({ title: 'Do it', body: 'It is done.' }),
    createPr: () => ({ number: 7, url: 'https://github.com/o/r/pull/7', state: 'OPEN', title: 'Do it' }),
  }
  const client = Object.fromEntries(
    (Object.keys(defaults) as (keyof CommitClient)[]).map((k) => [
      k,
      async (...args: unknown[]) => {
        calls.push([k, ...args])
        return (answers[k] ?? defaults[k])(...(args as never[]))
      },
    ]),
  ) as unknown as CommitClient
  return { client, calls, answers }
}

const deferred = <T,>() => {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe('the commit store', () => {
  it('picks every change but the conflicted on the first read, and keeps picks across reads', async () => {
    const { client, answers } = fake()
    const s = createCommitStore(client, '/code/app')
    await s.getState().load()
    expect(s.getState().picked).toEqual(['a.ts', 'b.ts'])
    s.getState().toggle('a.ts')
    expect(s.getState().picked).toEqual(['b.ts'])
    // A new file shows up: it starts picked, and the one left out stays out.
    answers.status = () => status({ changes: [change('a.ts'), change('b.ts'), change('d.ts')] })
    await s.getState().load()
    expect(s.getState().picked).toEqual(['b.ts', 'd.ts'])
    s.getState().pickAll(false)
    expect(s.getState().picked).toEqual([])
    s.getState().pickAll(true)
    expect(s.getState().picked).toEqual(['a.ts', 'b.ts', 'd.ts'])
  })

  it('shows a failed read and clears it on the next good one', async () => {
    const { client, answers } = fake({
      status: () => {
        throw 'git rev-parse: fatal: not a git repository'
      },
    })
    const s = createCommitStore(client, '/tmp/x')
    await s.getState().load()
    expect(s.getState().errors.status).toBe('git rev-parse: fatal: not a git repository')
    expect(s.getState().loading).toBe(false)
    answers.status = () => status()
    await s.getState().load()
    expect(s.getState().errors.status).toBeUndefined()
  })

  it('writes the message for the picked paths, and a stopped one never lands', async () => {
    const d = deferred<string>()
    const { client, calls, answers } = fake({ message: () => d.promise })
    const s = createCommitStore(client, '/code/app')
    await s.getState().load()
    s.getState().toggle('b.ts')
    const asked = s.getState().generate()
    expect(s.getState().generating).toBe(true)
    expect(calls.at(-1)).toEqual(['message', '/code/app', ['a.ts']])
    s.getState().stopGenerating()
    expect(s.getState().generating).toBe(false)
    d.resolve('late')
    await asked
    expect(s.getState().message).toBe('')

    answers.message = () => 'fix: a'
    await s.getState().generate()
    expect(s.getState().message).toBe('fix: a')
  })

  it('shows why the message could not be written', async () => {
    const { client } = fake({
      message: () => {
        throw 'claude: Invalid API key'
      },
    })
    const s = createCommitStore(client, '/code/app')
    await s.getState().load()
    await s.getState().generate()
    expect(s.getState().errors.message).toBe('claude: Invalid API key')
    expect(s.getState().generating).toBe(false)
  })

  it('does not ask for a message with nothing picked', async () => {
    const { client, calls } = fake()
    const s = createCommitStore(client, '/code/app')
    await s.getState().load()
    s.getState().pickAll(false)
    await s.getState().generate()
    expect(calls.some(([k]) => k === 'message')).toBe(false)
  })

  it('commits the picked paths with the message, clears it and reads the changes again', async () => {
    const { client, calls, answers } = fake()
    const s = createCommitStore(client, '/code/app')
    await s.getState().load()
    s.getState().setMessage('feat: a and b')
    answers.status = () => status({ ahead: 1, changes: [] })
    await s.getState().commit()
    expect(calls).toContainEqual(['commit', '/code/app', ['a.ts', 'b.ts'], 'feat: a and b'])
    expect(s.getState().committed).toEqual({ sha: 'abc1234', summary: 'feat: do it' })
    expect(s.getState().message).toBe('')
    expect(s.getState().status?.ahead).toBe(1)
    expect(calls.some(([k]) => k === 'push')).toBe(false)
  })

  it('keeps the message and shows what the hook said when a commit fails', async () => {
    const { client } = fake({
      commit: () => {
        throw 'git commit: lint: 3 problems'
      },
    })
    const s = createCommitStore(client, '/code/app')
    await s.getState().load()
    s.getState().setMessage('feat: x')
    await s.getState().commit()
    expect(s.getState().errors.commit).toBe('git commit: lint: 3 problems')
    expect(s.getState().message).toBe('feat: x')
    expect(s.getState().committing).toBe(false)
  })

  it('does not commit without a message', async () => {
    const { client, calls } = fake()
    const s = createCommitStore(client, '/code/app')
    await s.getState().load()
    s.getState().setMessage('   ')
    await s.getState().commit()
    expect(calls.some(([k]) => k === 'commit')).toBe(false)
  })

  it('commit and push pushes after the commit, then looks for the PR', async () => {
    const { client, calls } = fake()
    const s = createCommitStore(client, '/code/app')
    await s.getState().load()
    s.getState().setMessage('feat: x')
    await s.getState().commit({ andPush: true })
    const order = calls.map(([k]) => k)
    expect(order.indexOf('push')).toBeGreaterThan(order.indexOf('commit'))
    expect(order.lastIndexOf('findPr')).toBeGreaterThan(order.indexOf('push'))
    expect(s.getState().pushed).toBe('Pushed feat to origin')
  })

  it('shows a refused push', async () => {
    const { client } = fake({
      push: () => {
        throw 'git push: ! [rejected] HEAD -> feat (fetch first)'
      },
    })
    const s = createCommitStore(client, '/code/app')
    expect(await s.getState().push()).toBe(false)
    expect(s.getState().errors.push).toContain('rejected')
    expect(s.getState().pushing).toBe(false)
  })

  it('opens the PR form on the base branch with a drafted title and body', async () => {
    const { client, calls } = fake()
    const s = createCommitStore(client, '/code/app')
    await s.getState().load()
    s.getState().openPr()
    expect(s.getState().prForm?.base).toBe('main')
    expect(s.getState().drafting).toBe(true)
    await vi.waitFor(() => expect(s.getState().drafting).toBe(false))
    expect(calls).toContainEqual(['draftPr', '/code/app', 'main'])
    expect(s.getState().prForm).toEqual({ base: 'main', title: 'Do it', body: 'It is done.', draft: false })
  })

  it('pushes an unpublished branch before creating the PR, then shows it', async () => {
    const { client, calls, answers } = fake({ status: () => status({ published: false, ahead: 2 }) })
    const s = createCommitStore(client, '/code/app')
    await s.getState().load()
    s.getState().openPr()
    await vi.waitFor(() => expect(s.getState().drafting).toBe(false))
    s.getState().setPr({ title: 'My title', draft: true })
    answers.status = () => status({ published: true, ahead: 0 })
    await s.getState().createPr()
    const order = calls.map(([k]) => k)
    expect(order.indexOf('push')).toBeLessThan(order.indexOf('createPr'))
    expect(calls).toContainEqual(['createPr', '/code/app', { base: 'main', title: 'My title', body: 'It is done.', draft: true }])
    expect(s.getState().pr?.number).toBe(7)
    expect(s.getState().prForm).toBeNull()
  })

  it('does not create the PR when the push before it fails', async () => {
    const { client, calls } = fake({
      status: () => status({ published: false }),
      push: () => {
        throw 'git push: Permission denied'
      },
    })
    const s = createCommitStore(client, '/code/app')
    await s.getState().load()
    s.getState().openPr()
    await vi.waitFor(() => expect(s.getState().drafting).toBe(false))
    await s.getState().createPr()
    expect(calls.some(([k]) => k === 'createPr')).toBe(false)
    expect(s.getState().errors.push).toBe('git push: Permission denied')
    expect(s.getState().creating).toBe(false)
    expect(s.getState().prForm).not.toBeNull()
  })

  it('shows what gh said when the PR cannot be created or drafted, keeping the form', async () => {
    const { client } = fake({
      draftPr: () => {
        throw 'feat has no commits that main does not have.'
      },
      createPr: () => {
        throw 'gh pr create: a pull request for branch "feat" already exists'
      },
    })
    const s = createCommitStore(client, '/code/app')
    await s.getState().load()
    s.getState().openPr()
    await vi.waitFor(() => expect(s.getState().errors.pr).toBe('feat has no commits that main does not have.'))
    s.getState().setPr({ title: 'T' })
    await s.getState().createPr()
    expect(s.getState().errors.pr).toContain('already exists')
    expect(s.getState().prForm?.title).toBe('T')
    s.getState().dismiss('pr')
    expect(s.getState().errors.pr).toBeUndefined()
  })

  it('finds the branch PR, and shows a failed lookup', async () => {
    const pr: PullRequest = { number: 3, url: 'u', state: 'OPEN', title: 't' }
    const { client, answers } = fake({ findPr: () => pr })
    const s = createCommitStore(client, '/code/app')
    await s.getState().findPr()
    expect(s.getState().pr).toEqual(pr)
    answers.findPr = () => {
      throw 'gh: not logged in'
    }
    await s.getState().findPr()
    expect(s.getState().errors.pr).toBe('gh: not logged in')
  })
})

test('said reads a Tauri refusal, an Error and anything else', () => {
  expect(said('no')).toBe('no')
  expect(said(new Error('boom'))).toBe('boom')
  expect(said({ code: 1 })).toBe('{"code":1}')
  expect(said('')).toBe('It failed without saying why.')
})
