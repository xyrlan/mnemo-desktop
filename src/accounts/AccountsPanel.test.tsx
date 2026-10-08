import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AccountsPanel } from './AccountsPanel'
import { AccountSwitcher } from './AccountSwitcher'
import { PaneAccount } from './PaneAccount'
import { AccountsContext, createAccountsStore, type AccountsStore } from './store'
import { account, fakeClient, limit, NOW, reading, settle } from './testing'
import type { AccountsState, PlanUsage } from './types'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// The panel is rendered on its own: the switcher's popover is never opened here (an open popper
// layer never settles in jsdom, memory opening-a-popper-menu-hangs-vitest). The preview scenario
// `accounts` shoots it open.

const state = (): AccountsState => ({
  active: 'default',
  accounts: [account('default', { label: 'Personal', email: 'me@example.com' }), account('work', { problem: 'Not logged in yet.', email: null })],
})
const usage = (): Record<string, PlanUsage | string> => ({
  default: reading([
    limit('session', 34),
    limit('weekly_all', 36, { active: true, resetsAt: '2026-10-13T16:00:00Z' }),
    limit('weekly_scoped', 0, { model: 'Fable' }),
    limit('monthly_burst', 91, { severity: 'critical', resetsAt: null }),
  ]),
  work: reading([limit('session', 12)], { stale: 'The token has expired.', fetchedAt: NOW - 2 * 3600_000, plan: null }),
})

let root: Root | null = null
let host: HTMLElement
let fake: ReturnType<typeof fakeClient>['fake']
let store: AccountsStore

async function mount(ui: React.ReactNode, init: Parameters<typeof fakeClient>[0] = { state: state(), usage: usage() }) {
  const made = fakeClient(init)
  fake = made.fake
  store = createAccountsStore(made.client)
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await act(async () => root!.render(<AccountsContext.Provider value={store}>{ui}</AccountsContext.Provider>))
  await act(settle)
}
// The switcher reads the clock itself: pinned to NOW, or a fixture's reset passes as the real day
// goes by and its limit reads 0%.
beforeEach(() => vi.useFakeTimers({ toFake: ['Date'], now: NOW }))
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
  vi.useRealTimers()
})

const card = (id: string) => host.querySelector(`[data-account="${id}"]`)!
const button = (label: string, within: ParentNode = host) => [...within.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? b.textContent?.trim()) === label) as HTMLButtonElement
// React's act thenable needs both callbacks of `then`: await it, never chain it.
async function click(el: HTMLElement) {
  await act(async () => el.click())
  await act(settle)
}
async function type(input: HTMLInputElement, text: string) {
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    set.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function submit(input: HTMLInputElement) {
  await act(async () => input.form!.requestSubmit())
  await act(settle)
}

test('every account shows its label and email, the active one marked', async () => {
  await mount(<AccountsPanel now={NOW} />)
  expect(card('default').textContent).toContain('Personal')
  expect(card('default').textContent).toContain('me@example.com')
  expect(card('default').getAttribute('aria-current')).toBe('true')
  expect(card('work').hasAttribute('aria-current')).toBe(false)
  expect(card('work').textContent).toContain('no email yet')
  expect(button('Personal, active')).toBeTruthy()
  expect(button('Switch to Work')).toBeTruthy()
})

test("an account's problem is said", async () => {
  await mount(<AccountsPanel now={NOW} />)
  expect(card('work').querySelector('[data-problem]')?.textContent).toBe('Not logged in yet.')
  expect(card('default').querySelector('[data-problem]')).toBeNull()
})

test('every limit shows: named, a bar by severity, the percent and the reset; an unknown kind too', async () => {
  await mount(<AccountsPanel now={NOW} />)
  const rows = [...card('default').querySelectorAll('[data-limit]')]
  expect(rows.map((r) => r.getAttribute('data-limit'))).toEqual(['session', 'weekly_all', 'weekly_scoped', 'monthly_burst'])
  expect(rows[0].textContent).toContain('Session')
  expect(rows[0].textContent).toContain('34%')
  expect(rows[0].textContent).toContain('resets in 5 h 10 m')
  expect(rows[2].textContent).toContain('Weekly · Fable')
  expect(rows[3].textContent).toContain('Monthly burst')
  expect(rows[3].textContent).toContain('91%')
  const bar = rows[3].querySelector('[role="progressbar"]')!
  expect(bar.getAttribute('aria-valuenow')).toBe('91')
  expect(bar.getAttribute('data-severity')).toBe('critical')
  expect((bar.firstElementChild as HTMLElement).className).toContain('bg-destructive')
  expect((rows[0].querySelector('[role="progressbar"]')!.firstElementChild as HTMLElement).className).toContain('bg-status-success')
  expect(card('default').textContent).toContain('max')
})

test("a stale reading says how old it is and why", async () => {
  await mount(<AccountsPanel now={NOW} />)
  expect(card('work').querySelector('[data-stale]')?.textContent).toBe('Read 2 h ago: The token has expired.')
  expect(card('default').querySelector('[data-stale]')).toBeNull()
})

test('an account with no reading at all says why', async () => {
  await mount(<AccountsPanel now={NOW} />, { state: state(), usage: { default: reading([]), work: 'No credentials for Work.' } })
  expect(card('work').textContent).toContain('No usage: No credentials for Work.')
})

test('picking another account switches; the active one does nothing', async () => {
  await mount(<AccountsPanel now={NOW} />)
  await click(button('Personal, active'))
  expect(fake.called('switch')).toHaveLength(0)
  await click(button('Switch to Work'))
  expect(fake.called('switch')).toEqual([['switch', 'work']])
  expect(card('work').getAttribute('aria-current')).toBe('true')
})

test('renaming edits the label in place', async () => {
  await mount(<AccountsPanel now={NOW} />)
  await click(button('Rename Work'))
  const input = card('work').querySelector('input')!
  expect(input.value).toBe('Work')
  await type(input, 'Job')
  await submit(input)
  expect(fake.called('rename')).toEqual([['rename', 'work', 'Job']])
  expect(card('work').querySelector('input')).toBeNull()
  expect(button('Switch to Job')).toBeTruthy()
})

test('Escape leaves a rename without saving', async () => {
  await mount(<AccountsPanel now={NOW} />)
  await click(button('Rename Work'))
  const input = card('work').querySelector('input')!
  await act(async () => void input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(card('work').querySelector('input')).toBeNull()
  expect(fake.called('rename')).toHaveLength(0)
})

test('removing says the folder stays on disk, and asks first; the default account has no remove', async () => {
  await mount(<AccountsPanel now={NOW} />)
  expect(button('Remove Personal')).toBeUndefined()
  await click(button('Remove Work'))
  const ask = card('work').querySelector('[role="alertdialog"]')!
  expect(ask.textContent).toContain('/Users/me/.claude-work stays on disk')
  expect(fake.called('remove')).toHaveLength(0)
  await click(button('Remove', ask))
  expect(fake.called('remove')).toEqual([['remove', 'work']])
  expect(host.querySelector('[data-account="work"]')).toBeNull()
})

test('cancel leaves the account', async () => {
  await mount(<AccountsPanel now={NOW} />)
  await click(button('Remove Work'))
  await click(button('Cancel', card('work')))
  expect(card('work').querySelector('[role="alertdialog"]')).toBeNull()
  expect(fake.called('remove')).toHaveLength(0)
})

test('adding asks the label, then opens a login terminal on the new account', async () => {
  let added = 0
  await mount(<AccountsPanel now={NOW} onAdded={() => added++} />)
  await click(button('Add account'))
  const input = host.querySelector<HTMLInputElement>('input[aria-label="New account\'s name"]')!
  expect(button('Add').disabled).toBe(true)
  await type(input, '  Side  ')
  await submit(input)
  expect(fake.called('add')).toEqual([['add', 'Side']])
  expect(fake.called('terminal')).toEqual([['terminal', 'claude', 'side']])
  expect(added).toBe(1)
  expect(card('side').textContent).toContain('Side')
  expect(host.querySelector('input')).toBeNull()
})

test('a refused add says why and keeps the label asked', async () => {
  await mount(<AccountsPanel now={NOW} />)
  fake.refuse.add = 'An account named Work exists.'
  await click(button('Add account'))
  const input = host.querySelector<HTMLInputElement>('input')!
  await type(input, 'Work')
  await submit(input)
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('An account named Work exists.')
  expect(host.querySelector('input')).not.toBeNull()
  await click(button('Dismiss'))
  expect(host.querySelector('[role="alert"]')).toBeNull()
})

test("the switcher shows the active account's label and its tightest limit", async () => {
  await mount(<AccountSwitcher />)
  const trigger = host.querySelector<HTMLButtonElement>('[data-account-switcher]')!
  expect(trigger.getAttribute('aria-label')).toBe('Claude accounts: Personal')
  // monthly_burst at 91% is the tightest of the default account's.
  expect(trigger.textContent).toContain('91%')
  expect(trigger.title).toContain('Monthly burst 91%')
  expect(trigger.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('91')
})

test('the switcher follows a switch made elsewhere', async () => {
  await mount(<AccountSwitcher />)
  await act(async () => fake.emit({ ...fake.state, active: 'work' }))
  await act(settle)
  const trigger = host.querySelector<HTMLButtonElement>('[data-account-switcher]')!
  expect(trigger.getAttribute('aria-label')).toBe('Claude accounts: Work')
  expect(trigger.textContent).toContain('12%')
  expect(trigger.title).toContain('Old reading: The token has expired.')
  expect(trigger.title).toContain('Not logged in yet.')
})

test('the switcher draws nothing before the accounts are known', async () => {
  const { client, fake: f } = fakeClient({ state: state() })
  f.refuse.list = 'command accounts_list not found'
  const s = createAccountsStore(client)
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await act(async () => root!.render(<AccountsContext.Provider value={s}><AccountSwitcher /></AccountsContext.Provider>))
  await act(settle)
  expect(host.innerHTML).toBe('')
})

test('a pane on another account than the active one says which, when there is more than one', async () => {
  await mount(
    <>
      <span data-pane="3"><PaneAccount id={3} /></span>
      <span data-pane="4"><PaneAccount id={4} /></span>
      <span data-pane="5"><PaneAccount id={5} /></span>
    </>,
    { state: state(), usage: usage(), panes: { 3: 'work', 4: 'default' } },
  )
  const pane = (id: number) => host.querySelector(`[data-pane="${id}"]`)!
  expect(pane(3).textContent).toBe('Work')
  expect(pane(4).textContent).toBe('')
  // Spawned after the last switch: on the active account.
  expect(pane(5).textContent).toBe('')
  await act(async () => fake.emit({ ...fake.state, active: 'work' }))
  await act(settle)
  expect(pane(3).textContent).toBe('')
  expect(pane(4).textContent).toBe('Personal')
  // One account left: no pane says it.
  await act(async () => fake.emit({ active: 'default', accounts: [account('default')] }))
  await act(settle)
  expect(pane(3).textContent).toBe('')
})
