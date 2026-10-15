import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'
import { createStore } from 'zustand/vanilla'
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

const stackEl = () => document.querySelector('[data-notification-stack]')

test('no cards, no stack', async () => {
  await mount([])
  expect(stackEl()).toBeNull()
})

test('cards draw newest first, at the top, in the ship\'s look, at the end of <body> in a layer of their own', async () => {
  const { host } = await mount([card(1, 'done'), card(2, 'permission', { name: 'lib', repo: 'lib' }), card(3, 'question', { repo: null })])
  const stack = stackEl()!
  // Portaled, as the Nexus's windows and menus are: never inside the shell's overlay slot.
  expect(stack.parentElement).toBe(document.body)
  expect(host.innerHTML).toBe('')
  // The ship's frame and tokens (`.nx`), its own column (`notify.css`): no workbench components.
  expect(stack.className).toBe('nx nx-notes')
  const cards = [...stack.querySelectorAll('[role="complementary"]')]
  expect(cards.map((c) => c.getAttribute('aria-label'))).toEqual(['feat: Has a question', 'lib: Needs permission', 'feat: Done'])
  expect(cards.map((c) => c.getAttribute('data-kind'))).toEqual(['question', 'permission', 'done'])
  // The repo shows beside the name only when it says something the name does not.
  expect(cards[2].textContent).toContain('app')
  expect(cards[1].textContent).not.toContain('liblib')
  // Colour means state only, set by the card's kind.
  expect(cards.every((c) => c.className === 'nx-note')).toBe(true)
  expect(cards[2].querySelector('.nx-note-kind')!.textContent).toBe('Done')
  expect(cards[2].querySelector('svg')!.getAttribute('class')).toContain('nx-note-icon')
})

test('a click opens the card, the cross and Escape dismiss it', async () => {
  const { opened, dismissed } = await mount([card(5, 'done')])
  const [body, cross] = stackEl()!.querySelectorAll('button')
  await act(async () => body.click())
  expect(opened).toEqual([5])
  await act(async () => cross.click())
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
  const [unopened, plain] = [...stackEl()!.querySelectorAll('[role="complementary"]')]
  expect(unopened.querySelector('[data-unopened]')?.textContent).toBe('It is not on the ship yet: nothing to open.')
  expect(plain.querySelector('[data-unopened]')).toBeNull()
})
