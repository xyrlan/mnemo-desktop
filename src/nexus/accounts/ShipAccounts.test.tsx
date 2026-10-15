import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { AccountsContext, createAccountsStore } from '../../accounts/store'
import { account, fakeClient, limit, NOW, reading, settle } from '../../accounts/testing'
import { ShipAccounts } from './ShipAccounts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../drawer/open', () => ({ openSession: async () => {} }))
vi.mock('@tauri-apps/api/path', () => ({ homeDir: async () => '/Users/me' }))

const two = () =>
  fakeClient({
    state: { active: 'default', accounts: [account('default', { label: 'Personal' }), account('work')] },
    usage: { default: reading([limit('session', 42, { severity: 'normal' }), limit('weekly_all', 71, { severity: 'warning' })]), work: reading([limit('session', 5)]) },
  })

let unmount: () => Promise<void>
let portal: HTMLElement

async function render(f: ReturnType<typeof fakeClient>) {
  const store = createAccountsStore(f.client)
  portal = document.body.appendChild(document.createElement('div'))
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <AccountsContext.Provider value={store}>
        <ShipAccounts portal={portal} />
      </AccountsContext.Provider>,
    ),
  )
  await act(settle)
  await act(settle)
  unmount = () => act(async () => root.unmount())
  return store
}

beforeEach(() => vi.useFakeTimers({ now: NOW, toFake: ['Date'] }))
afterEach(async () => {
  await unmount?.()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

const switcher = () => document.querySelector<HTMLButtonElement>('[data-account-switcher]')!
const pop = () => portal.querySelector<HTMLElement>('[data-nx-accounts]')

test('the switcher names the active account and its tightest limit, in the ship’s look', async () => {
  await render(two())
  expect(switcher().getAttribute('aria-label')).toBe('Claude accounts: Personal')
  expect(switcher().closest('.ship-accounts')!.classList.contains('nx')).toBe(true)
  expect(switcher().textContent).toContain('71%')
  expect(switcher().querySelector('[role="progressbar"]')!.getAttribute('data-tone')).toBe('warn')
  expect(switcher().title).toContain('Weekly 71%')
  expect(switcher().querySelector('.nx-switch-warn')).toBeNull()
})

test('a click opens every account in the portal and reads their usage again; a pick switches, and the bar follows', async () => {
  const f = two()
  await render(f)
  const before = f.fake.called('usage').length
  await act(async () => switcher().click())
  expect(pop()).not.toBeNull()
  expect(switcher().getAttribute('aria-expanded')).toBe('true')
  expect(f.fake.called('usage').slice(before)).toEqual([
    ['usage', 'default', true],
    ['usage', 'work', true],
  ])
  expect([...pop()!.querySelectorAll('[data-account]')].map((li) => li.getAttribute('data-account'))).toEqual(['default', 'work'])
  await act(async () => pop()!.querySelector<HTMLButtonElement>('[aria-label="Switch to Work"]')!.click())
  await act(settle)
  expect(f.fake.called('switch')).toEqual([['switch', 'work']])
  expect(switcher().getAttribute('aria-label')).toBe('Claude accounts: Work')
})

test('Esc, a click outside and a second click on the switcher close the accounts', async () => {
  await render(two())
  await act(async () => switcher().click())
  await act(async () => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(pop()).toBeNull()
  expect(document.activeElement).toBe(switcher())
  await act(async () => switcher().click())
  await act(async () => void document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
  expect(pop()).toBeNull()
  await act(async () => switcher().click())
  await act(async () => void pop()!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
  expect(pop()).not.toBeNull()
  await act(async () => switcher().click())
  expect(pop()).toBeNull()
})

test('Esc in a name being typed cancels the typing and leaves the accounts open', async () => {
  await render(two())
  await act(async () => switcher().click())
  await act(async () => pop()!.querySelector<HTMLButtonElement>('[aria-label="Rename Work"]')!.click())
  const input = pop()!.querySelector<HTMLInputElement>('input')!
  expect(document.activeElement).toBe(input)
  await act(async () => void input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(pop()).not.toBeNull()
  expect(pop()!.querySelector('input')).toBeNull()
})

test('an account with a problem, or a failure, marks the switcher', async () => {
  const f = fakeClient({ state: { active: 'work', accounts: [account('default'), account('work', { problem: 'Not logged in yet.' })] } })
  await render(f)
  expect(switcher().querySelector('.nx-switch-warn')!.getAttribute('aria-label')).toBe('Not logged in yet.')
})

test('a list that cannot be read says so with a retry, and the switcher comes once it can', async () => {
  const f = two()
  f.fake.refuse.list = 'accounts.json is not valid JSON'
  await render(f)
  expect(switcher()).toBeNull()
  const alert = document.querySelector<HTMLElement>('[data-account-switcher-error]')!
  expect(alert.title).toContain('accounts.json is not valid JSON')
  delete f.fake.refuse.list
  await act(async () => alert.querySelector('button')!.click())
  await act(settle)
  expect(switcher().getAttribute('aria-label')).toBe('Claude accounts: Personal')
})

test('nothing is drawn while the accounts are not known and nothing failed', async () => {
  const f = two()
  f.fake.refuse.list = 'command accounts_list not found'
  await render(f)
  expect(document.querySelector('.ship-accounts')!.childElementCount).toBe(0)
})
