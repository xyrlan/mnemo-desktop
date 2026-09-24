import { expect, test } from 'vitest'
import type { AgentEvent } from '../agents/events'
import { alertFor, inside, looking, paneOf, placeOf, shownWorktree } from './decide'
import { REPOS } from './test-fleet'

const ev = (kind: AgentEvent['kind'], cwd: string, message?: string, sessionId = 's-x'): AgentEvent => ({ sessionId, cwd, kind, at: 100, ...(message ? { message } : {}) })

test('inside is by whole path segments, and ignores a trailing separator and Windows slashes', () => {
  expect(inside('/a/b', '/a/b')).toBe(true)
  expect(inside('/a/b/c', '/a/b/')).toBe(true)
  expect(inside('/a/bc', '/a/b')).toBe(false)
  expect(inside('/a', '/a/b')).toBe(false)
  expect(inside('C:\\code\\app\\src', 'C:/code/app')).toBe(true)
  expect(inside('/anything', '/')).toBe(true)
})

test('placeOf picks the deepest worktree, across repos, or none', () => {
  expect(placeOf('/code/app/src', REPOS)).toEqual({ path: '/code/app', name: 'app', repo: 'app' })
  expect(placeOf('/code/app/.claude/worktrees/feat/src', REPOS)).toEqual({ path: '/code/app/.claude/worktrees/feat', name: 'feat', repo: 'app' })
  expect(placeOf('/code/lib-wt', REPOS)?.path).toBe('/code/lib-wt')
  expect(placeOf('/elsewhere', REPOS)).toBeNull()
  const nestedFirst = [{ ...REPOS[0], worktrees: [...REPOS[0].worktrees].reverse() }]
  expect(placeOf('/code/app/.claude/worktrees/feat/src', nestedFirst)?.name).toBe('feat')
})

test('shownWorktree is the active one, else the first repo main checkout', () => {
  expect(shownWorktree('/code/lib', REPOS)).toBe('/code/lib')
  expect(shownWorktree(null, REPOS)).toBe('/code/app')
  expect(shownWorktree(null, [{ ...REPOS[1], worktrees: [REPOS[1].worktrees[1], REPOS[1].worktrees[0]] }])).toBe('/code/lib')
  expect(shownWorktree(null, [{ ...REPOS[1], worktrees: [REPOS[1].worktrees[1]] }])).toBe('/code/lib-wt')
  expect(shownWorktree(null, [])).toBeNull()
})

test('a stop is a finished turn, titled from the fleet', () => {
  expect(alertFor(ev('stop', '/code/app/.claude/worktrees/feat', undefined, 's-feat'), REPOS)).toEqual({
    sessionId: 's-feat',
    kind: 'done',
    worktree: '/code/app/.claude/worktrees/feat',
    name: 'feat',
    repo: 'app',
    message: 'Finished: Add login',
    at: 100,
  })
  expect(alertFor(ev('stop', '/code/lib'), REPOS)?.message).toBe('Claude finished its turn')
  // The fleet's stand-in title for a session it has no name for says nothing.
  const unnamed = [{ ...REPOS[1], worktrees: [{ ...REPOS[1].worktrees[0], agents: [{ ...REPOS[0].worktrees[0].agents[0], sessionId: 'abcdef1234', title: 'session abcdef12' }] }] }]
  expect(alertFor(ev('stop', '/code/lib', undefined, 'abcdef1234'), unnamed)?.message).toBe('Claude finished its turn')
})

test('a notification is a permission or a question, and the idle nudge and login are nothing', () => {
  expect(alertFor(ev('notification', '/code/lib', 'Claude needs your permission to use Bash'), REPOS)).toMatchObject({ kind: 'permission', message: 'Claude needs your permission to use Bash' })
  expect(alertFor(ev('notification', '/code/lib', 'Claude has a question'), REPOS)?.kind).toBe('question')
  expect(alertFor(ev('notification', '/code/lib', 'Claude is waiting for your input'), REPOS)).toBeNull()
  expect(alertFor(ev('notification', '/code/lib', 'auth_success'), REPOS)).toBeNull()
  expect(alertFor(ev('notification', '/code/lib'), REPOS)).toMatchObject({ kind: 'question', message: 'Claude has a question for you' })
  expect(alertFor(ev('notification', '/code/lib', '  '), REPOS)?.message).toBe('Claude has a question for you')
})

test('start, prompt and end are not alerts', () => {
  for (const k of ['start', 'prompt', 'end'] as const) expect(alertFor(ev(k, '/code/lib'), REPOS)).toBeNull()
})

test('an agent in a folder no repo owns is named by its folder', () => {
  expect(alertFor(ev('stop', '/tmp/scratch/'), REPOS)).toMatchObject({ worktree: null, name: 'scratch', repo: null })
})

test('paneOf finds the pane the fleet knows for a session', () => {
  expect(paneOf('s-feat', REPOS)).toBe(7)
  expect(paneOf('nobody', REPOS)).toBeNull()
})

test('you are looking only with focus, at its worktree or a pane of the shown tabs', () => {
  const at = { focused: true, shown: '/code/app', shownPanes: [3], pane: null }
  expect(looking({ worktree: '/code/app' }, at)).toBe(true)
  expect(looking({ worktree: '/code/app/' }, at)).toBe(true)
  expect(looking({ worktree: '/code/app' }, { ...at, focused: false })).toBe(false)
  expect(looking({ worktree: '/code/app/.claude/worktrees/feat' }, at)).toBe(false)
  expect(looking({ worktree: null }, at)).toBe(false)
  expect(looking({ worktree: null }, { ...at, pane: 3 })).toBe(true)
  expect(looking({ worktree: null }, { ...at, shown: null, pane: 4 })).toBe(false)
})
