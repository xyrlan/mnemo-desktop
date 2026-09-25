import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { AgentEvent } from '../agents/events'
import { createNotifier, DONE_TTL_MS, MAX_CARDS, SOUND_GAP_MS, type NotifierDeps } from './notifier'
import { REPOS } from './test-fleet'

let emit: (e: AgentEvent) => void
let look: () => void
let world: { active: string | null; shownPanes: number[]; focused: boolean; now: number }
let native: Array<[string, string]>
let sounds: number
let switched: Array<[string | null, number | null]>
let unsubscribed: number
let nativeFails: boolean

function make(over: Partial<NotifierDeps> = {}) {
  return createNotifier({
    subscribe(cb) {
      emit = cb
      return () => void unsubscribed++
    },
    repos: () => REPOS,
    active: () => world.active,
    shownPanes: () => world.shownPanes,
    focused: () => world.focused,
    onLook(cb) {
      look = cb
      return () => void unsubscribed++
    },
    // A plain recorder, not vi.fn(): a rejected spy fails the test on vitest 5.
    native: async (t, b) => {
      native.push([t, b])
      if (nativeFails) throw new Error('denied')
    },
    sound: () => void sounds++,
    switchTo: (w, p) => void switched.push([w, p]),
    now: () => world.now,
    ...over,
  })
}

const FEAT = '/code/app/.claude/worktrees/feat'
const stop = (sessionId: string, cwd: string): AgentEvent => ({ sessionId, cwd, kind: 'stop', at: 1 })
const ask = (sessionId: string, cwd: string, message = 'Claude needs your permission to use Bash'): AgentEvent => ({ sessionId, cwd, kind: 'notification', message, at: 1 })

beforeEach(() => {
  world = { active: '/code/app', shownPanes: [3], focused: true, now: 10_000 }
  native = []
  sounds = 0
  switched = []
  unsubscribed = 0
  nativeFails = false
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

test('nothing fires for the worktree you are looking at', () => {
  const n = make()
  emit(stop('s-main', '/code/app'))
  emit(ask('s-main', '/code/app/src'))
  expect(n.cards.getState().cards).toEqual([])
  expect(sounds).toBe(0)
  expect(native).toEqual([])
})

test('a worktree off screen, with focus: a card and a chime, no native notification', () => {
  const n = make()
  emit(stop('s-feat', FEAT))
  expect(n.cards.getState().cards).toMatchObject([{ sessionId: 's-feat', kind: 'done', worktree: FEAT, name: 'feat', repo: 'app', pane: 7, message: 'Finished: Add login' }])
  expect(sounds).toBe(1)
  expect(native).toEqual([])
})

test('the window unfocused: even the worktree on screen notifies, natively too', async () => {
  world.focused = false
  const n = make()
  emit(ask('s-main', '/code/app'))
  expect(n.cards.getState().cards).toHaveLength(1)
  expect(sounds).toBe(1)
  expect(native).toEqual([['app', 'Claude needs your permission to use Bash']])
  emit(stop('s-feat', FEAT))
  expect(native[1]).toEqual(['app · feat', 'Finished: Add login'])
})

test('a refused native notification is only a warning', async () => {
  world.focused = false
  nativeFails = true
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const n = make()
  emit(stop('s-feat', FEAT))
  await vi.runAllTicks()
  await Promise.resolve()
  expect(n.cards.getState().cards).toHaveLength(1)
  expect(warn).toHaveBeenCalledWith('notify: no native notification', expect.any(Error))
  warn.mockRestore()
})

test('before any worktree is chosen, the first repo main checkout counts as on screen', () => {
  world.active = null
  const n = make()
  emit(stop('s-main', '/code/app'))
  expect(n.cards.getState().cards).toEqual([])
  emit(stop('s-x', '/code/lib'))
  expect(n.cards.getState().cards).toHaveLength(1)
})

test('an agent in no repo, in a pane of the shown tabs, is on screen; elsewhere it is not', () => {
  const n = make({ repos: () => [{ ...REPOS[0], worktrees: [REPOS[0].worktrees[1]] }] })
  world.active = FEAT
  world.shownPanes = [7]
  // s-feat is in pane 7 and in FEAT: looking. A stranger in /tmp with no pane: not.
  emit(stop('s-feat', '/tmp/x'))
  expect(n.cards.getState().cards).toEqual([])
  emit(stop('s-stranger', '/tmp/x'))
  expect(n.cards.getState().cards).toMatchObject([{ worktree: null, name: 'x', pane: null }])
})

test('the idle nudge, start and prompt raise nothing', () => {
  const n = make()
  emit(ask('s-feat', FEAT, 'Claude is waiting for your input'))
  emit({ ...stop('s-feat', FEAT), kind: 'start' })
  emit({ ...stop('s-feat', FEAT), kind: 'prompt' })
  expect(n.cards.getState().cards).toEqual([])
  expect(sounds).toBe(0)
})

test('one card per session: a newer alert replaces its card', () => {
  const n = make()
  emit(stop('s-feat', FEAT))
  emit(ask('s-feat', FEAT))
  expect(n.cards.getState().cards.map((c) => c.kind)).toEqual(['permission'])
})

test('a prompt, a start or an end of the session takes its card back', () => {
  const n = make()
  for (const kind of ['prompt', 'start', 'end'] as const) {
    emit(ask('s-feat', FEAT))
    emit(stop('s-x', '/code/lib'))
    emit({ ...stop('s-feat', FEAT), kind })
    expect(n.cards.getState().cards.map((c) => c.sessionId)).toEqual(['s-x'])
  }
})

test(`at most ${MAX_CARDS} cards, the oldest leaving first`, () => {
  const n = make()
  for (let i = 0; i < MAX_CARDS + 2; i++) emit(ask(`s${i}`, '/code/lib'))
  expect(n.cards.getState().cards.map((c) => c.sessionId)).toEqual(['s2', 's3', 's4', 's5'])
})

test('a finished turn leaves on its own; an ask stays', () => {
  const n = make()
  emit(stop('s-feat', FEAT))
  emit(ask('s-x', '/code/lib'))
  vi.advanceTimersByTime(DONE_TTL_MS - 1)
  expect(n.cards.getState().cards).toHaveLength(2)
  vi.advanceTimersByTime(1)
  expect(n.cards.getState().cards.map((c) => c.sessionId)).toEqual(['s-x'])
  vi.advanceTimersByTime(DONE_TTL_MS * 10)
  expect(n.cards.getState().cards).toHaveLength(1)
})

test('a replaced finished card does not take its replacement with it', () => {
  const n = make()
  emit(stop('s-feat', FEAT))
  vi.advanceTimersByTime(DONE_TTL_MS / 2)
  emit(ask('s-feat', FEAT))
  vi.advanceTimersByTime(DONE_TTL_MS)
  expect(n.cards.getState().cards.map((c) => c.kind)).toEqual(['permission'])
})

test(`alerts closer than ${SOUND_GAP_MS} ms chime once`, () => {
  make()
  emit(stop('s1', '/code/lib'))
  world.now += SOUND_GAP_MS - 1
  emit(stop('s2', '/code/lib'))
  expect(sounds).toBe(1)
  world.now += 1
  emit(stop('s3', '/code/lib'))
  expect(sounds).toBe(2)
})

test('clicking a card switches to its worktree and pane, and the card goes', () => {
  const n = make()
  emit(stop('s-feat', FEAT))
  emit(stop('s-x', '/code/lib'))
  emit(stop('s-y', '/tmp/y'))
  const [feat, lib, stray] = n.cards.getState().cards
  n.open(feat.id)
  n.open(lib.id)
  n.open(stray.id)
  expect(switched).toEqual([[FEAT, 7], ['/code/lib', null]])
  expect(n.cards.getState().cards).toEqual([])
  n.open(feat.id)
  expect(switched).toHaveLength(2)
})

test('a dispatched child’s card opens its parent’s Dispatch tab instead of its worktree', () => {
  const routed: Array<[string, string | null]> = []
  const n = make({ openChild: (sid, w) => (sid === 's-feat' ? (routed.push([sid, w]), true) : false) })
  emit(stop('s-feat', FEAT))
  emit(stop('s-x', '/code/lib'))
  const [feat, lib] = n.cards.getState().cards
  n.open(feat.id)
  n.open(lib.id)
  expect(routed).toEqual([['s-feat', FEAT]])
  expect(switched).toEqual([['/code/lib', null]])
  expect(n.cards.getState().cards).toEqual([])
})

test('dismiss drops only that card', () => {
  const n = make()
  emit(stop('s-feat', FEAT))
  emit(stop('s-x', '/code/lib'))
  n.dismiss(n.cards.getState().cards[0].id)
  expect(n.cards.getState().cards.map((c) => c.sessionId)).toEqual(['s-x'])
})

test('showing a worktree, with focus, clears its cards', () => {
  world.focused = false
  const n = make()
  emit(stop('s-feat', FEAT))
  emit(stop('s-x', '/code/lib'))
  world.active = FEAT
  look()
  expect(n.cards.getState().cards).toHaveLength(2)
  world.focused = true
  look()
  expect(n.cards.getState().cards.map((c) => c.sessionId)).toEqual(['s-x'])
})

test('stop unsubscribes and clears', () => {
  const n = make()
  emit(stop('s-feat', FEAT))
  n.stop()
  expect(unsubscribed).toBe(2)
  expect(n.cards.getState().cards).toEqual([])
  vi.advanceTimersByTime(DONE_TTL_MS)
})
