import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'
import { createStore } from 'zustand/vanilla'
import { constellation } from '../ds'
import { EMPTY, worldStore } from '../world/store'
import type { Session } from '../world/types'
import { NotificationStack } from './NotificationStack'
import type { Card, Cards } from './notifier'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const card = (id: number, kind: Card['kind'], over: Partial<Card> = {}): Card => ({
  id,
  kind,
  sessionId: `s${id}`,
  worktree: '/code/app/feat',
  name: 'feat',
  repo: 'app',
  message: kind === 'done' ? 'Finished: Add login' : 'Claude needs your permission to use Bash',
  at: 0,
  key: `session:s${id}`,
  ...over,
})

afterEach(() => {
  document.body.innerHTML = ''
  worldStore.setState({ world: EMPTY })
  localStorage.clear()
})

/** A world that knows these sessions by their titles. */
const know = (titles: Record<string, string>) =>
  worldStore.setState({ world: { ...EMPTY, sessions: Object.entries(titles).map(([id, title]) => ({ id, short: id.slice(0, 8), title }) as Session) } })

async function mount(cards: Card[]) {
  const store = createStore<Cards>(() => ({ cards }))
  const opened: number[] = []
  const dismissed: number[] = []
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () => root.render(<NotificationStack notifier={{ cards: store, open: (id) => void opened.push(id), dismiss: (id) => void dismissed.push(id) }} />))
  return { host, store, opened, dismissed, root }
}

const stackEl = () => document.querySelector('[data-notification-stack]')
const cardEls = () => [...stackEl()!.querySelectorAll('[role="complementary"]')]

test('no cards, no stack', async () => {
  await mount([])
  expect(stackEl()).toBeNull()
})

test('cards draw newest first, at the top, at the end of <body> in a layer of their own', async () => {
  const { host } = await mount([card(1, 'done'), card(2, 'permission', { name: 'lib', repo: 'lib' }), card(3, 'question', { repo: null })])
  const stack = stackEl()!
  // Portaled, as the Nexus's windows and menus are: never inside the shell's overlay slot.
  expect(stack.parentElement).toBe(document.body)
  expect(host.innerHTML).toBe('')
  // A root of the new identity of its own: it is drawn outside the frame's.
  expect(stack.classList.contains('mn')).toBe(true)
  const cards = cardEls()
  expect(cards.map((c) => c.getAttribute('aria-label'))).toEqual(['feat: Has a question', 'lib: Needs permission', 'feat: Done'])
  expect(cards.map((c) => c.getAttribute('data-kind'))).toEqual(['question', 'permission', 'done'])
  // The repo shows beside the name only when it says something the name does not.
  expect(cards[2].querySelector('.note-where')!.textContent).toBe('app')
  expect(cards[1].querySelector('.note-where')).toBeNull()
  expect(cards[0].querySelector('.note-where')).toBeNull()
  expect(cards[2].querySelector('.note-kind')!.textContent).toBe('Done')
  expect(cards[2].querySelector('.note-message')!.textContent).toBe('Finished: Add login')
})

test('what happened is a state: an ask is a need, a finished turn is your move', async () => {
  await mount([card(1, 'done'), card(2, 'permission'), card(3, 'question')])
  const cards = cardEls()
  expect(cards.map((c) => [c.getAttribute('data-kind'), c.getAttribute('data-state')])).toEqual([
    ['question', 'need'],
    ['permission', 'need'],
    ['done', 'idle'],
  ])
  // The state is a shape before a colour: each card draws its mark.
  expect(cards.map((c) => c.querySelector('.mn-state')!.getAttribute('data-state'))).toEqual(['need', 'need', 'idle'])
})

test("a card carries its session's figure: the same for one session, another for the next", async () => {
  await mount([card(1, 'done'), card(2, 'question')])
  const figures = [...stackEl()!.querySelectorAll('[data-asset="session-figure"]')]
  expect(figures).toHaveLength(2)
  const stars = (svg: Element) => [...svg.querySelectorAll('circle:not(.mn-figure-ring)')].map((c) => [Number(c.getAttribute('cx')), Number(c.getAttribute('cy'))])
  // Newest first: the question's session `s2`, then the finished one's `s1`.
  expect(stars(figures[0])).toEqual(constellation('s2').points.map(([x, y]) => [x, y]))
  expect(stars(figures[1])).toEqual(constellation('s1').points.map(([x, y]) => [x, y]))
  expect(stars(figures[0])).not.toEqual(stars(figures[1]))
})

test('where the world knows the session, the card is headed by its title, in full, over where it runs', async () => {
  const long = 'Idempotent retries for the billing webhooks, with a dead-letter queue for the ones that still fail'
  know({ s1: long, s3: 'Release 2.4 checklist' })
  await mount([card(3, 'done', { name: 'lib', repo: 'lib' }), card(1, 'permission', { name: 'feat', repo: 'app' }), card(2, 'done', { name: 'lib', repo: 'lib' })])
  const [unknown, known, same] = cardEls()
  expect(known.querySelector('.note-title')!.textContent).toBe(long)
  expect(known.getAttribute('aria-label')).toBe(`${long}: Needs permission`)
  expect(known.querySelector('.note-where')!.textContent).toBe('app · feat')
  // A session the world does not have keeps the name of where it runs.
  expect(unknown.querySelector('.note-title')!.textContent).toBe('lib')
  expect(unknown.querySelector('.note-where')).toBeNull()
  // A main checkout is named as its repo is: said once.
  expect(same.querySelector('.note-title')!.textContent).toBe('Release 2.4 checklist')
  expect(same.querySelector('.note-where')!.textContent).toBe('lib')
})

test('a card shows the keys that act on it', async () => {
  await mount([card(1, 'question')])
  const keys = stackEl()!.querySelector('.note-keys')!
  expect([...keys.querySelectorAll('kbd')].map((k) => k.textContent)).toEqual(['Enter', 'Esc'])
  expect(keys.textContent).toBe('Enter open Esc dismiss')
  // They are the keys of the card's own button: Enter is its click, Esc its dismissal.
  expect(keys.closest('button')).toBe(stackEl()!.querySelector('button'))
})

test('a click opens the card, the cross and Escape dismiss it', async () => {
  const { opened, dismissed } = await mount([card(5, 'done')])
  const [body, cross] = stackEl()!.querySelectorAll('button')
  await act(async () => body.click())
  expect(opened).toEqual([5])
  await act(async () => cross.click())
  expect(dismissed).toEqual([5])
  // Escape is the one key that dismisses: Enter is the button's own click, and any other is not the card's.
  for (const key of ['Enter', 'n', ' ']) await act(async () => void body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))
  expect(dismissed).toEqual([5])
  await act(async () => void body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(dismissed).toEqual([5, 5])
  expect(cross.getAttribute('aria-label')).toBe('Dismiss')
})

test('the stack follows its store', async () => {
  const { store } = await mount([card(1, 'done')])
  await act(async () => store.setState({ cards: [] }))
  expect(stackEl()).toBeNull()
  await act(async () => store.setState({ cards: [card(2, 'question')] }))
  expect(stackEl()!.querySelectorAll('[role="complementary"]')).toHaveLength(1)
})

test('a card whose click opened nothing says so', async () => {
  await mount([card(1, 'done'), card(2, 'question', { unopened: true })])
  const [unopened, plain] = cardEls()
  expect(unopened.querySelector('[data-unopened]')?.textContent).toBe('It is not on the ship yet: nothing to open.')
  expect(plain.querySelector('[data-unopened]')).toBeNull()
  expect(stackEl()!.querySelector('button')!.title).toBe('Open it in the Nexus')
})

test('in the new front a card speaks of the stage and the fleet, not of the ship', async () => {
  localStorage.setItem('mnemo.next', '1')
  await mount([card(2, 'question', { unopened: true })])
  expect(stackEl()!.querySelector('button')!.title).toBe('Open it on stage')
  expect(stackEl()!.querySelector('[data-unopened]')!.textContent).toBe('It is not in the fleet yet: nothing to open.')
})

test("the frame's motion switch stills the stack", async () => {
  const frame = document.body.appendChild(document.createElement('div'))
  frame.className = 'mn'
  frame.dataset.view = 'orbit'
  await mount([card(1, 'done')])
  expect(stackEl()!.hasAttribute('data-motion')).toBe(false)
  await act(async () => frame.setAttribute('data-motion', 'reduced'))
  expect(stackEl()!.getAttribute('data-motion')).toBe('reduced')
})
