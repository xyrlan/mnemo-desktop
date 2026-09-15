import { vi } from 'vitest'
import { createGithubStore } from './store'
import type { GithubClient } from './client'
import { board, mnemoIssues } from './fixtures'
import type { Auth } from './types'

const logged: Auth = { installed: true, logged: true, login: 'me', scopes: ['repo'] }

function client(over: Partial<GithubClient> = {}): GithubClient {
  return { auth: async () => logged, issues: async () => mnemoIssues, project: async () => board, ...over }
}

test('auth loads, and a junk answer (no gh command in a test host) keeps null', async () => {
  const s = createGithubStore(client())
  expect(s.getState().auth).toBeNull()
  expect(await s.getState().loadAuth()).toEqual(logged)
  const junk = createGithubStore(client({ auth: async () => ({}) as Auth }))
  expect(await junk.getState().loadAuth()).toBeNull()
})

test('issues are fetched unfiltered, once at a time, and an error keeps the last list', async () => {
  const issues = vi.fn(async () => mnemoIssues)
  const s = createGithubStore(client({ issues }), () => 7)
  await Promise.all([s.getState().loadIssues('/r'), s.getState().loadIssues('/r')])
  expect(issues).toHaveBeenCalledTimes(1)
  expect(issues).toHaveBeenCalledWith('/r', [])
  expect(s.getState().issues['/r']).toEqual({ list: mnemoIssues, error: null, at: 7 })
  issues.mockRejectedValueOnce('gh issue: no git remotes found')
  await s.getState().loadIssues('/r')
  expect(s.getState().issues['/r']).toMatchObject({ list: mnemoIssues, error: 'gh issue: no git remotes found' })
})

test('board: loading, the board, needs_scope', async () => {
  let release!: () => void
  const s = createGithubStore(client({ project: () => new Promise((r) => (release = () => r(board))) }))
  const p = s.getState().loadBoard('/r')
  expect(s.getState().boards['/r']).toMatchObject({ loading: true, board: null })
  release()
  await p
  expect(s.getState().boards['/r']).toMatchObject({ loading: false, board, error: null })
  const scoped = createGithubStore(client({ project: async () => Promise.reject('needs_scope') }))
  await scoped.getState().loadBoard('/r')
  expect(scoped.getState().boards['/r']).toMatchObject({ loading: false, board: null, error: 'needs_scope' })
})

test('watchLogin polls until logged in', async () => {
  vi.useFakeTimers()
  try {
    const answers: Auth[] = [{ ...logged, logged: false, login: null }, logged]
    const auth = vi.fn(async () => answers.shift() ?? logged)
    const s = createGithubStore(client({ auth }))
    s.getState().watchLogin(1000, 10)
    await vi.advanceTimersByTimeAsync(1000)
    expect(s.getState().auth?.logged).toBe(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(s.getState().auth?.logged).toBe(true)
    await vi.advanceTimersByTimeAsync(5000)
    expect(auth).toHaveBeenCalledTimes(2)
  } finally {
    vi.useRealTimers()
  }
})
