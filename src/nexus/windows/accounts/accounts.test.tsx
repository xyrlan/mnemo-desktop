import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { AccountsContext, createAccountsStore } from '../../../accounts/store'
import { account, fakeClient, limit, NOW, reading, settle } from '../../../accounts/testing'
import { ConfirmHost } from '../../ui/confirm'
import { WindowHost } from '../../ui/Window'
import { closeWindow, openWindow, windowStore, windowsIn } from '../../ui/windows'
import './index'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// A plain recorder: memory vitest5-spy-rejecting-a-string-fails-the-test.
const opened = vi.hoisted(() => ({ specs: [] as unknown[], refuse: null as string | null }))
vi.mock('../../drawer/open', () => ({
  openSession: async (spec: unknown) => {
    if (opened.refuse) throw new Error(opened.refuse)
    opened.specs.push(spec)
  },
}))
vi.mock('@tauri-apps/api/path', () => ({ homeDir: async () => '/Users/me' }))

let unmount: () => Promise<void>

async function render(f: ReturnType<typeof fakeClient>) {
  const store = createAccountsStore(f.client)
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <AccountsContext.Provider value={store}>
        <WindowHost />
        <ConfirmHost />
      </AccountsContext.Provider>,
    ),
  )
  await act(async () => openWindow('accounts'))
  await act(settle)
  await act(settle)
  unmount = () => act(async () => root.unmount())
  return store
}

const two = () =>
  fakeClient({
    state: { active: 'default', accounts: [account('default', { label: 'Personal' }), account('work')] },
    usage: { default: reading([limit('session', 42)]), work: reading([limit('session', 5)], { stale: 'The endpoint said 429.' }) },
  })

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
  opened.specs = []
  opened.refuse = null
})
afterEach(async () => {
  await unmount?.()
  closeWindow()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

const win = () => document.querySelector<HTMLElement>('[data-nx-window]')
const card = (id: string) => win()!.querySelector<HTMLElement>(`[data-account="${id}"]`)!
const button = (el: ParentNode, label: string) => el.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
const confirmButton = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('[data-nx-confirm] button')].find((b) => b.textContent === text)!
const type = (input: HTMLInputElement, text: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })

test('Accounts is a SYSTEMS window, after Setup and before Settings', () => {
  const w = windowsIn('systems').find((d) => d.id === 'accounts')!
  expect(w.title).toBe('Accounts')
  expect(w.order).toBe(40)
})

test('every account, its usage read again on opening, the active one marked; the default one cannot be removed', async () => {
  const f = two()
  await render(f)
  expect(win()!.querySelector('.nx-window-title')!.textContent).toBe('Accounts')
  expect(f.fake.called('usage').filter((c) => c[2] === true).map((c) => c[1])).toEqual(['default', 'work'])
  expect(card('default').hasAttribute('data-active')).toBe(true)
  expect(card('default').textContent).toContain('42%')
  expect(card('work').querySelector('[data-stale]')!.textContent).toContain('The endpoint said 429.')
  expect(button(card('default'), 'Remove Personal')).toBeNull()
  expect(button(card('work'), 'Remove Work')).not.toBeNull()
})

test('a removal is confirmed: Cancel keeps the account, Remove removes it', async () => {
  const f = two()
  await render(f)
  await act(async () => button(card('work'), 'Remove Work').click())
  expect(document.querySelector('[data-nx-confirm]')!.textContent).toContain('/Users/me/.claude-work stays on disk')
  await act(async () => confirmButton('Cancel').click())
  await act(settle)
  expect(f.fake.called('remove')).toEqual([])
  await act(async () => button(card('work'), 'Remove Work').click())
  expect(confirmButton('Remove').dataset.tone).toBe('danger')
  await act(async () => confirmButton('Remove').click())
  await act(settle)
  expect(f.fake.called('remove')).toEqual([['remove', 'work']])
  expect(win()!.querySelector('[data-account="work"]')).toBeNull()
})

test('a rename: Enter saves; Esc cancels the typing and leaves the window open', async () => {
  const f = two()
  await render(f)
  await act(async () => button(card('work'), 'Rename Work').click())
  let input = card('work').querySelector<HTMLInputElement>('input')!
  await act(async () => void input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(windowStore.getState().open?.id).toBe('accounts')
  expect(card('work').querySelector('input')).toBeNull()
  await act(async () => button(card('work'), 'Rename Work').click())
  input = card('work').querySelector<HTMLInputElement>('input')!
  await type(input, 'Job')
  await act(async () => input.form!.requestSubmit())
  await act(settle)
  expect(f.fake.called('rename')).toEqual([['rename', 'work', 'Job']])
  expect(card('work').querySelector('input')).toBeNull()
})

test('an add opens its login terminal on the new account, the active one staying, and the window gives way to it', async () => {
  const f = two()
  await render(f)
  await act(async () => [...win()!.querySelectorAll('button')].find((b) => b.textContent === '+ Add account')!.click())
  const input = win()!.querySelector<HTMLInputElement>('input[aria-label="New account\'s name"]')!
  await type(input, 'Client')
  await act(async () => input.form!.requestSubmit())
  await act(settle)
  expect(f.fake.called('add')).toEqual([['add', 'Client']])
  expect(f.fake.called('terminal')).toEqual([['terminal', 'claude', 'client']])
  expect(f.fake.state.active).toBe('default')
  expect(windowStore.getState().open).toBeNull()
})

test('Sign in opens claude on that account in the drawer, from the home folder, and the window gives way', async () => {
  await render(two())
  await act(async () => button(card('work'), 'Sign in to Work').click())
  await act(settle)
  expect(opened.specs).toEqual([{ kind: 'command', root: '/Users/me', command: 'env CLAUDE_CONFIG_DIR=/Users/me/.claude-work claude', label: 'Sign in: Work' }])
  expect(windowStore.getState().open).toBeNull()
})

test('a sign-in terminal that cannot open says why, and the window stays', async () => {
  await render(two())
  opened.refuse = 'no pty'
  await act(async () => button(card('default'), 'Sign in to Personal').click())
  await act(settle)
  expect(windowStore.getState().open?.id).toBe('accounts')
  expect(win()!.querySelector('[role="alert"]')!.textContent).toContain('Could not open a terminal to sign in to Personal: no pty')
})

test('a failure of the store is said and dismissed', async () => {
  const f = two()
  f.fake.refuse.rename = 'accounts.json is read-only'
  await render(f)
  await act(async () => button(card('work'), 'Rename Work').click())
  const input = card('work').querySelector<HTMLInputElement>('input')!
  await type(input, 'Job')
  await act(async () => input.form!.requestSubmit())
  await act(settle)
  const alert = win()!.querySelector<HTMLElement>('[role="alert"]')!
  expect(alert.textContent).toContain('accounts.json is read-only')
  await act(async () => alert.querySelector('button')!.click())
  expect(win()!.querySelector('[role="alert"]')).toBeNull()
})

test('a list that cannot be read says so, with a retry', async () => {
  const f = two()
  f.fake.refuse.list = 'accounts.json is not valid JSON'
  await render(f)
  const alert = win()!.querySelector<HTMLElement>('[role="alert"]')!
  expect(alert.textContent).toContain('accounts.json is not valid JSON')
  delete f.fake.refuse.list
  await act(async () => alert.querySelector('button')!.click())
  await act(settle)
  expect(card('work')).not.toBeNull()
})
