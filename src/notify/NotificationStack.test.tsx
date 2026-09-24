import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'
import { createStore } from 'zustand/vanilla'
import { NotificationStack } from './NotificationStack'
import type { Card, Cards } from './notifier'
import { ownRoot } from './slot'
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
  pane: null,
  ...over,
})

afterEach(() => void (document.body.innerHTML = ''))

async function mount(cards: Card[]) {
  const store = createStore<Cards>(() => ({ cards }))
  const opened: number[] = []
  const dismissed: number[] = []
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () => root.render(<NotificationStack notifier={{ cards: store, open: (id) => void opened.push(id), dismiss: (id) => void dismissed.push(id) }} />))
  return { host, store, opened, dismissed, root }
}

test('no cards, no stack', async () => {
  const { host } = await mount([])
  expect(host.innerHTML).toBe('')
})

test('cards draw newest first in the DOM, which the reversed column puts at the bottom', async () => {
  const { host } = await mount([card(1, 'done'), card(2, 'permission', { name: 'lib', repo: 'lib' }), card(3, 'question', { repo: null })])
  const stack = host.querySelector('[data-notification-stack]')!
  expect(stack.className).toContain('flex-col-reverse')
  expect(stack.className).toContain('fixed')
  expect(stack.hasAttribute('data-ui')).toBe(true)
  const cards = [...stack.querySelectorAll('[role="complementary"]')]
  expect(cards.map((c) => c.getAttribute('aria-label'))).toEqual(['feat: Has a question', 'lib: Needs permission', 'feat: Done'])
  expect(cards.map((c) => c.getAttribute('data-kind'))).toEqual(['question', 'permission', 'done'])
  // The repo shows beside the name only when it says something the name does not.
  expect(cards[2].textContent).toContain('app')
  expect(cards[1].textContent).not.toContain('liblib')
  expect(cards[2].querySelector('svg')!.getAttribute('class')).toContain('text-state-done')
  expect(cards[1].querySelector('svg')!.getAttribute('class')).toContain('text-state-needs-you')
})

test('a click opens the card, the cross and Escape dismiss it', async () => {
  const { host, opened, dismissed } = await mount([card(5, 'done')])
  const [body, cross] = host.querySelectorAll('button')
  await act(async () => body.click())
  expect(opened).toEqual([5])
  await act(async () => cross.click())
  await act(async () => void body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(dismissed).toEqual([5, 5])
  expect(cross.getAttribute('aria-label')).toBe('Dismiss')
})

test('the stack follows its store', async () => {
  const { host, store } = await mount([card(1, 'done')])
  await act(async () => store.setState({ cards: [] }))
  expect(host.innerHTML).toBe('')
  await act(async () => store.setState({ cards: [card(2, 'question')] }))
  expect(host.querySelectorAll('[role="complementary"]')).toHaveLength(1)
})

test('without the shell, the stack gets its own root on <body>, gone on unmount', async () => {
  let off!: () => void
  await act(async () => void (off = ownRoot('overlay', () => <p>hi</p>)))
  const host = document.querySelector('[data-notify-host]')!
  expect(host.parentElement).toBe(document.body)
  expect(host.textContent).toBe('hi')
  await act(async () => off())
  expect(document.querySelector('[data-notify-host]')).toBeNull()
})
