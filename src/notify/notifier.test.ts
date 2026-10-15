import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { AgentEvent } from '../agents/events'
import type { PolledMove } from '../fleet/create'
import { COALESCE_MS, createNotifier, DONE_TTL_MS, MAX_CARDS, SOUND_GAP_MS, type NotifierDeps } from './notifier'
import type { Shown } from './decide'
import { REPOS } from './test-fleet'

let emit: (e: AgentEvent) => void
let poll: (m: PolledMove) => void
let look: () => void
let world: { shown: Shown | null; focused: boolean; now: number }
let native: Array<[string, string]>
let sounds: number
let opened: Array<[string, string | null]>
let opens: boolean
let unsubscribed: number
let nativeFails: boolean

function make(over: Partial<NotifierDeps> = {}) {
  return createNotifier({
    subscribe(cb) {
      emit = cb
      return () => void unsubscribed++
    },
    polled(cb) {
      poll = cb
      return () => void unsubscribed++
    },
    repos: () => REPOS,
    shown: () => world.shown,
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
    open: (sid, w) => (opened.push([sid, w]), opens),
    now: () => world.now,
    ...over,
  })
}

const FEAT = '/code/app/.claude/worktrees/feat'
const stop = (sessionId: string, cwd: string): AgentEvent => ({ sessionId, cwd, kind: 'stop', at: 1 })
const ask = (sessionId: string, cwd: string, message = 'Claude needs your permission to use Bash'): AgentEvent => ({ sessionId, cwd, kind: 'notification', message, at: 1 })
const prompt = (sessionId: string, cwd: string, message: string): AgentEvent => ({ sessionId, cwd, kind: 'prompt', message, at: 1 })
const REPORT = 'Another Claude session sent a message:\n<mnemo-child-finished id="720a903b" state="ci-red">'

beforeEach(() => {
  // s-main's captain is the drawer's tab on screen.
  world = { shown: { sessionId: 's-main', worktree: null }, focused: true, now: 10_000 }
  native = []
  sounds = 0
  opened = []
  opens = true
  unsubscribed = 0
  nativeFails = false
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

test('nothing fires for the session the drawer shows', () => {
  const n = make()
  emit(stop('s-main', '/code/app'))
  emit(ask('s-main', '/code/app/src'))
  expect(n.cards.getState().cards).toEqual([])
  expect(sounds).toBe(0)
  expect(native).toEqual([])
})

test('a session off screen, with focus: a card and a chime, no native notification', () => {
  const n = make()
  emit(stop('s-feat', FEAT))
  expect(n.cards.getState().cards).toMatchObject([{ sessionId: 's-feat', kind: 'done', worktree: FEAT, name: 'feat', repo: 'app', message: 'Finished: Add login' }])
  expect(sounds).toBe(1)
  expect(native).toEqual([])
})

test('the window unfocused: even the session on screen notifies, natively too', async () => {
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

test('with no session on screen (the Nexus closed, the drawer collapsed or empty), every session notifies', () => {
  world.shown = null
  const n = make()
  emit(stop('s-main', '/code/app'))
  expect(n.cards.getState().cards.map((c) => c.sessionId)).toEqual(['s-main'])
})

test('another session in the checkout of the captain on screen still notifies', () => {
  const n = make()
  emit(stop('s-other', '/code/app'))
  expect(n.cards.getState().cards.map((c) => c.sessionId)).toEqual(['s-other'])
})

test('a dispatched child’s tab on screen covers the child resumed as a new session in its tree', () => {
  world.shown = { sessionId: 's-feat', worktree: FEAT }
  const n = make()
  emit(stop('s-feat-resumed', `${FEAT}/src`))
  expect(n.cards.getState().cards).toEqual([])
  emit(stop('s-stranger', '/tmp/x'))
  expect(n.cards.getState().cards).toMatchObject([{ worktree: null, name: 'x' }])
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

test('clicking a card opens its session in the Nexus, with where it runs, and the card goes', () => {
  const n = make()
  emit(stop('s-feat', FEAT))
  emit(stop('s-x', '/code/lib'))
  emit(stop('s-y', '/tmp/y'))
  const [feat, lib, stray] = n.cards.getState().cards
  n.open(feat.id)
  n.open(lib.id)
  n.open(stray.id)
  expect(opened).toEqual([
    ['s-feat', FEAT],
    ['s-x', '/code/lib'],
    ['s-y', null],
  ])
  expect(n.cards.getState().cards).toEqual([])
  n.open(feat.id)
  expect(opened).toHaveLength(3)
})

test('a card whose click opens nothing stays, marked so, until a newer alert or a click that opens', () => {
  const n = make()
  emit(stop('s-feat', FEAT))
  const [feat] = n.cards.getState().cards
  opens = false
  n.open(feat.id)
  expect(n.cards.getState().cards).toMatchObject([{ id: feat.id, sessionId: 's-feat', unopened: true }])
  // A newer alert about it is a new card's worth of news: no stale mark.
  emit(ask('s-feat', FEAT))
  expect(n.cards.getState().cards).toMatchObject([{ id: feat.id, kind: 'permission' }])
  expect(n.cards.getState().cards[0].unopened).toBeUndefined()
  opens = true
  n.open(feat.id)
  expect(n.cards.getState().cards).toEqual([])
  expect(opened).toHaveLength(2)
})

test('dismiss drops only that card', () => {
  const n = make()
  emit(stop('s-feat', FEAT))
  emit(stop('s-x', '/code/lib'))
  n.dismiss(n.cards.getState().cards[0].id)
  expect(n.cards.getState().cards.map((c) => c.sessionId)).toEqual(['s-x'])
})

test('showing a session in the drawer, with focus, clears its card', () => {
  world.focused = false
  const n = make()
  emit(stop('s-feat', FEAT))
  emit(stop('s-x', '/code/lib'))
  world.shown = { sessionId: 's-feat', worktree: FEAT }
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
  expect(unsubscribed).toBe(3)
  expect(n.cards.getState().cards).toEqual([])
  vi.advanceTimersByTime(DONE_TTL_MS)
})

test('a turn only mnemo or a peer started tells nothing when it ends, and leaves the card alone', () => {
  world.focused = false
  const n = make()
  emit(stop('s-x', '/code/lib'))
  const [card] = n.cards.getState().cards
  for (const m of [REPORT, '<mnemo-resume id="ab12">', '<mnemo-pr-follow pr="3">', '🧹 removed wt-3 and its branch fix/3']) {
    emit(prompt('s-x', '/code/lib', m))
    emit(stop('s-x', '/code/lib'))
  }
  expect(n.cards.getState().cards).toEqual([card])
  expect([sounds, native.length]).toEqual([1, 1])
})

test('a turn only a finished background task started tells nothing when it ends; an ask in it still tells', () => {
  world.focused = false
  const n = make()
  const done = '<task-notification>\n<task-id>b7fi1avmy</task-id>\n<tool-use-id>toolu_018W</tool-use-id>\n<status>completed</status>'
  emit(stop('s-x', '/code/lib'))
  const [card] = n.cards.getState().cards
  emit(prompt('s-x', '/code/lib', done))
  emit(stop('s-x', '/code/lib'))
  expect(n.cards.getState().cards).toEqual([card])
  expect([sounds, native.length]).toEqual([1, 1])
  emit(prompt('s-x', '/code/lib', done))
  emit(ask('s-x', '/code/lib', 'Claude has a question for you'))
  expect(n.cards.getState().cards.map((c) => c.kind)).toEqual(['question'])
  expect(native).toHaveLength(2)
})

test('a person’s turn with a report card queued in it still tells when it ends', () => {
  world.focused = false
  const n = make()
  emit(prompt('s-x', '/code/lib', 'merge #12 please'))
  emit(prompt('s-x', '/code/lib', REPORT))
  emit(stop('s-x', '/code/lib'))
  expect(n.cards.getState().cards).toHaveLength(1)
  expect(native).toHaveLength(1)
})

test('an ask in a turn mnemo started still tells you', () => {
  world.focused = false
  const n = make()
  emit(prompt('s-x', '/code/lib', REPORT))
  emit(ask('s-x', '/code/lib'))
  expect(n.cards.getState().cards.map((c) => c.kind)).toEqual(['permission'])
  expect(native).toEqual([['lib', 'Claude needs your permission to use Bash']])
})

test(`finished turns of one session within ${COALESCE_MS} ms update its card in place and chime once`, () => {
  world.focused = false
  const n = make()
  emit(stop('s-x', '/code/lib'))
  const { id } = n.cards.getState().cards[0]
  world.now += COALESCE_MS - 1
  emit(stop('s-x', '/code/lib'))
  expect(n.cards.getState().cards.map((c) => c.id)).toEqual([id])
  expect([sounds, native.length]).toEqual([1, 1])
  world.now += 1
  emit(stop('s-x', '/code/lib'))
  expect([sounds, native.length]).toEqual([2, 2])
})

test('a person’s prompt makes the next finish news again, however soon', () => {
  world.focused = false
  make()
  emit(stop('s-x', '/code/lib'))
  emit(prompt('s-x', '/code/lib', 'and the tests?'))
  world.now += SOUND_GAP_MS
  emit(stop('s-x', '/code/lib'))
  expect(native).toHaveLength(2)
})

test('the same ask again is quiet; a new ask, or one after a finish, still tells', () => {
  world.focused = false
  make()
  emit(ask('s-x', '/code/lib'))
  world.now += SOUND_GAP_MS
  emit(ask('s-x', '/code/lib'))
  expect(native).toHaveLength(1)
  emit(ask('s-x', '/code/lib', 'Claude needs your permission to use Edit'))
  expect(native).toHaveLength(2)
})

test('a resume that forks a new session in a dispatched tree reads as the same child', () => {
  world.focused = false
  const n = make()
  emit(ask('s-feat', FEAT))
  emit({ ...stop('s-fork', FEAT), kind: 'start' })
  expect(n.cards.getState().cards).toEqual([])
  emit(stop('s-feat', FEAT))
  emit(stop('s-fork', FEAT))
  expect(n.cards.getState().cards.map((c) => c.sessionId)).toEqual(['s-fork'])
  // One child, told once within the window: the ask; its finishes after the fork only update the card.
  expect(native).toHaveLength(1)
  // The old job ending takes only its own card.
  emit({ ...stop('s-feat', FEAT), kind: 'end' })
  expect(n.cards.getState().cards).toHaveLength(1)
})

test('two sessions in one checkout that is not a dispatched tree keep a card each', () => {
  const n = make()
  emit(stop('s-a', '/code/lib'))
  emit(stop('s-b', '/code/lib'))
  expect(n.cards.getState().cards.map((c) => c.sessionId)).toEqual(['s-a', 's-b'])
})

describe('from polled moves, where no hook is heard (Windows; a dispatched child anywhere)', () => {
  const moved = (sessionId: string, cwd: string, state: PolledMove['state'], over: Partial<PolledMove> = {}): PolledMove => ({
    sessionId, cwd, child: false, state, waitingFor: state === 'needs-you' ? 'permission' : null, ask: null, at: 1, ...over,
  })

  test('a finished turn and an ask notify as a hook’s would, and going back to work clears the card', () => {
    world.focused = false
    const n = make()
    poll(moved('s-x', '/code/lib', 'done'))
    expect(n.cards.getState().cards).toMatchObject([{ sessionId: 's-x', kind: 'done', name: 'lib', message: 'Claude finished its turn' }])
    expect([sounds, native]).toEqual([1, [['lib', 'Claude finished its turn']]])

    poll(moved('s-x', '/code/lib', 'working'))
    expect(n.cards.getState().cards).toEqual([])
    world.now += SOUND_GAP_MS
    poll(moved('s-x', '/code/lib', 'needs-you', { waitingFor: 'question' }))
    expect(n.cards.getState().cards).toMatchObject([{ kind: 'question', message: 'Claude has a question for you' }])
    expect(native).toHaveLength(2)
    // Back at work, then done: news again, however soon.
    poll(moved('s-x', '/code/lib', 'working'))
    world.now += SOUND_GAP_MS
    poll(moved('s-x', '/code/lib', 'done'))
    expect(native).toHaveLength(3)
  })

  test('nothing for the session the drawer shows', () => {
    const n = make()
    poll(moved('s-main', '/code/app', 'done'))
    poll(moved('s-main', '/code/app', 'needs-you'))
    expect([n.cards.getState().cards, sounds]).toEqual([[], 0])
  })

  test('a dispatched child’s ask notifies with what it asks; its finish is its parent’s news', () => {
    world.focused = false
    const n = make()
    poll(moved('s-feat', FEAT, 'needs-you', { child: true, ask: 'Bash: pnpm test' }))
    expect(n.cards.getState().cards).toMatchObject([{ key: `tree:${FEAT}`, kind: 'permission', name: 'feat', message: 'Needs your permission: Bash: pnpm test' }])
    expect(native).toEqual([['app · feat', 'Needs your permission: Bash: pnpm test']])
    poll(moved('s-feat', FEAT, 'working', { child: true }))
    poll(moved('s-feat', FEAT, 'done', { child: true }))
    expect([n.cards.getState().cards, native.length]).toEqual([[], 1])
  })
})

describe('from both sources at once: one notification per event', () => {
  const moved = (sessionId: string, cwd: string, state: PolledMove['state'], waitingFor: PolledMove['waitingFor'] = null): PolledMove => ({
    sessionId, cwd, child: false, state, waitingFor, ask: null, at: 1,
  })

  test('a poll landing just before the hook: the hook’s words replace the card, and nothing chimes twice', () => {
    world.focused = false
    const n = make()
    poll(moved('s-x', '/code/lib', 'needs-you', 'permission'))
    const { id } = n.cards.getState().cards[0]
    world.now += SOUND_GAP_MS
    emit(ask('s-x', '/code/lib'))
    expect(n.cards.getState().cards).toMatchObject([{ id, kind: 'permission', message: 'Claude needs your permission to use Bash' }])
    expect([sounds, native.length]).toEqual([1, 1])

    emit(prompt('s-x', '/code/lib', 'go on'))
    poll(moved('s-x', '/code/lib', 'done'))
    world.now += SOUND_GAP_MS
    emit(stop('s-x', '/code/lib'))
    expect([sounds, native.length]).toEqual([2, 2])
  })

  test('a poll after the hook keeps the hook’s card and says nothing more', () => {
    world.focused = false
    const n = make()
    emit(ask('s-x', '/code/lib'))
    world.now += SOUND_GAP_MS
    poll(moved('s-x', '/code/lib', 'needs-you', 'permission'))
    expect(n.cards.getState().cards).toMatchObject([{ message: 'Claude needs your permission to use Bash' }])
    expect([sounds, native.length]).toEqual([1, 1])
  })

  test('a turn a quiet prompt started stays quiet when a poll sees it end before its stop hook', () => {
    world.focused = false
    const n = make()
    emit(prompt('s-x', '/code/lib', REPORT))
    poll(moved('s-x', '/code/lib', 'done'))
    emit(stop('s-x', '/code/lib'))
    expect([n.cards.getState().cards, sounds, native]).toEqual([[], 0, []])
  })
})
