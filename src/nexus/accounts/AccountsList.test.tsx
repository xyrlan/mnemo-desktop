import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { AccountsClient } from '../../accounts/client'
import { AccountsContext, createAccountsStore } from '../../accounts/store'
import { account, fakeClient, limit, NOW, reading, settle } from '../../accounts/testing'
import type { Account } from '../../accounts/types'
import { AccountsList } from './AccountsList'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// A plain recorder: memory vitest5-spy-rejecting-a-string-fails-the-test.
const opened = vi.hoisted(() => ({ specs: [] as { command?: string; label?: string }[] }))
vi.mock('../drawer/open', () => ({ openSession: async (spec: { command?: string; label?: string }) => void opened.specs.push(spec) }))
vi.mock('@tauri-apps/api/path', () => ({ homeDir: async () => '/Users/me' }))

const claude = (id: string, more: Partial<Account> = {}) => account(id, { kind: 'claude', ...more })
const grok = account('grok', { kind: 'grok', label: 'Grok', configDir: '/Users/me/.grok', email: 'me@x.ai' })
const side = account('side', { kind: 'grok', label: 'Side', configDir: '/Users/me/.grok-side' })

let unmount: () => Promise<void>

async function render(client: AccountsClient) {
  const store = createAccountsStore(client)
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <AccountsContext.Provider value={store}>
        <AccountsList now={NOW} onTerminal={() => {}} />
      </AccountsContext.Provider>,
    ),
  )
  await act(settle)
  await act(settle)
  unmount = () => act(async () => root.unmount())
  return store
}

/** The fake, with an add that answers an account of the kind asked, and records the kind. */
function kinded(accounts: Account[]) {
  const f = fakeClient({ state: { active: 'default', accounts }, usage: { default: reading([limit('session', 10)]), side: 'No credit reading yet.' } })
  const kinds: unknown[] = []
  const client: AccountsClient = {
    ...f.client,
    add: async (label, kind) => {
      kinds.push(kind)
      const a = kind === 'grok' ? account(label.toLowerCase(), { label, kind, configDir: '/Users/me/.grok-x', email: null }) : claude(label.toLowerCase(), { label })
      f.fake.emit({ active: a.id, accounts: [...f.fake.state.accounts, a] })
      return a
    },
  }
  return { ...f, client, kinds }
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
  opened.specs = []
})
afterEach(async () => {
  await unmount?.()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

const card = (id: string) => document.querySelector<HTMLElement>(`[data-account="${id}"]`)!
const byText = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text)!
const type = (input: HTMLInputElement, text: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })

test('a list of Claude accounts alone names no kind', async () => {
  await render(kinded([claude('default'), claude('work')]).client)
  expect(document.querySelector('[data-kind]')).toBeNull()
})

test('a list with both kinds says each account’s CLI', async () => {
  await render(kinded([claude('default'), grok, side]).client)
  expect(card('default').querySelector('[data-kind]')!.textContent).toBe('Claude Code')
  expect(card('grok').querySelector('[data-kind]')!.textContent).toBe('Grok Build')
  expect(card('grok').textContent).toContain('me@x.ai')
})

test('a Grok account whose usage cannot be read says its credit usage is unavailable', async () => {
  await render(kinded([claude('default'), side]).client)
  expect(card('side').textContent).toContain('Credit usage unavailable: No credit reading yet.')
})

test('Sign in on a Grok account opens grok login on its own home', async () => {
  await render(kinded([claude('default'), side]).client)
  const signIn = card('side').querySelector<HTMLButtonElement>('button[aria-label="Sign in to Side"]')!
  expect(signIn.title).toBe('Opens a terminal running grok login on Side')
  await act(async () => signIn.click())
  await act(settle)
  expect(opened.specs.map((s) => s.command)).toEqual(['env MNEMO_AGENT=grok GROK_HOME=/Users/me/.grok-side grok login'])
})

test('adding asks the kind, Claude Code first; a Grok account is added as one and logs in with grok login', async () => {
  const f = kinded([claude('default')])
  await render(f.client)
  await act(async () => byText('+ Add account').click())
  const picker = document.querySelector('[role="group"][aria-label="New account\'s CLI"]')!
  const pressed = () => [...picker.querySelectorAll('button[aria-pressed="true"]')].map((b) => b.textContent)
  expect(pressed()).toEqual(['Claude Code'])
  expect(document.body.textContent).toContain('A terminal opens on it for you to log in.')
  await act(async () => byText('Grok Build').click())
  expect(pressed()).toEqual(['Grok Build'])
  expect(document.body.textContent).toContain('It is ~/.grok, with the login grok has there already.')
  const input = document.querySelector<HTMLInputElement>('input[aria-label="New account\'s name"]')!
  await type(input, 'Grok')
  await act(async () => input.form!.requestSubmit())
  await act(settle)
  expect(f.kinds).toEqual(['grok'])
  expect(f.fake.called('terminal')).toEqual([['terminal', 'grok login', 'grok']])
})

test('with the Grok account at ~/.grok taken, a new one is said to get a folder of its own', async () => {
  await render(kinded([claude('default'), grok]).client)
  await act(async () => byText('+ Add account').click())
  await act(async () => byText('Grok Build').click())
  expect(document.body.textContent).toContain('It gets a folder of its own, ~/.grok-<name>.')
})
