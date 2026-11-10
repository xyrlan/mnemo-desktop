// The Accounts panel on the accounts store, over the store's own stand-in client
// (`accounts/testing.ts`). A terminal is asked of the app's route, which a test sets.

import { AccountsContext, createAccountsStore } from '../../accounts/store'
import { account, fakeClient, limit, NOW, reading, settle } from '../../accounts/testing'
import { setNexusRoutes, type NexusRoutes } from '../../nexus/outside'
import { go, routeStore } from '../../world/route'
import { button, click, draw, flush, key, texts, type } from '../memory/testing'
import { AccountsPanel } from './Accounts'

const term = { opened: [] as { cwd: string | undefined; command: string; label: string }[], refuse: null as string | null }
const routes: NexusRoutes = {
  terminal: async (cwd, command, label) => {
    if (term.refuse) throw new Error(term.refuse)
    term.opened.push({ cwd, command, label })
  },
  page: async () => {},
  pages: () => {},
}

let undraw: (() => Promise<void>) | null = null
let unroute: () => void
async function open(f: ReturnType<typeof fakeClient>) {
  const store = createAccountsStore(f.client)
  undraw = await draw(
    <AccountsContext.Provider value={store}>
      <AccountsPanel />
    </AccountsContext.Provider>,
  )
  await flush()
  await flush()
  return store
}

const two = () =>
  fakeClient({
    state: { active: 'default', accounts: [account('default', { label: 'Personal' }), account('work')] },
    usage: {
      default: reading([limit('session', 62), limit('weekly_all', 30, { resetsAt: '2026-10-09T13:00:00Z' })]),
      work: reading([limit('session', 12)]),
    },
  })
const card = (id: string) => document.querySelector(`[data-account="${id}"]`)!

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
  term.opened = []
  term.refuse = null
  unroute = setNexusRoutes(routes)
  go({ panel: 'accounts' })
})
afterEach(async () => {
  await undraw?.()
  undraw = null
  unroute()
  go({ panel: null })
  vi.useRealTimers()
})

test('every account is listed, the active one marked, and opening reads every account’s usage afresh', async () => {
  const f = two()
  await open(f)
  expect(texts('.accounts-card .accounts-state')).toEqual(['new sessions run here', 'switch'])
  expect(card('default').hasAttribute('data-active')).toBe(true)
  expect(f.fake.called('usage')).toContainEqual(['usage', 'default', true])
  expect(f.fake.called('usage')).toContainEqual(['usage', 'work', true])
})

test('one press on another account switches to it', async () => {
  const f = two()
  const store = await open(f)
  await click(button('Switch to Work'))
  expect(f.fake.called('switch')).toEqual([['switch', 'work']])
  expect(store.getState().state!.active).toBe('work')
  expect(texts('.accounts-card .accounts-state')).toEqual(['switch', 'new sessions run here'])
})

test('a window reads its percent and when it resets; one whose reset has passed reads 0', async () => {
  const f = fakeClient({
    state: { active: 'default', accounts: [account('default')] },
    usage: { default: reading([limit('session', 62, { resetsAt: '2026-10-07T22:20:00Z' }), limit('weekly_all', 88, { resetsAt: '2026-10-07T19:00:00Z' }), limit('weekly_scoped', 41, { model: 'Fable', resetsAt: '2026-10-09T13:00:00Z' })]) },
  })
  await open(f)
  const rows = [...document.querySelectorAll('.accounts-limit')].map((li) => [li.querySelector('.accounts-limit-name')!.textContent, li.querySelector('.accounts-limit-pct')!.textContent, li.querySelector('.accounts-limit-reset')!.textContent])
  expect(rows[0]).toEqual(['Session', '62%', 'resets in 2 h 20 m'])
  expect(rows[1]).toEqual(['Weekly', '0%', 'reset'])
  expect(rows[2][0]).toBe('Weekly · Fable')
  expect(rows[2][1]).toBe('41%')
})

test('a window near its end says so in the endpoint’s word, not by colour alone', async () => {
  const f = fakeClient({ state: { active: 'default', accounts: [account('default')] }, usage: { default: reading([limit('session', 93, { severity: 'warning' }), limit('weekly_all', 20)]) } })
  await open(f)
  const [tight, calm] = [...document.querySelectorAll('.accounts-limit')]
  expect(tight.getAttribute('data-tone')).toBe('warn')
  expect(tight.querySelector('.accounts-limit-reset')!.textContent).toMatch(/^warning · resets /)
  expect(calm.querySelector('.accounts-severity')).toBeNull()
})

test('an account is removed only on a second press, and the default one cannot be', async () => {
  const f = two()
  await open(f)
  expect(button('Remove Personal')).toBeUndefined()
  await click(button('Remove Work'))
  expect(f.fake.called('remove')).toEqual([])
  await click(button('Remove Work'))
  expect(f.fake.called('remove')).toEqual([['remove', 'work']])
  expect(document.querySelector('[data-account="work"]')).toBeNull()
})

test('a rename is typed in place: Enter saves it, Esc cancels the typing and leaves the panel open', async () => {
  const f = two()
  await open(f)
  await click(button('Rename Work'))
  const field = () => document.querySelector<HTMLInputElement>('[aria-label="Account name"]')!
  expect(await key('Escape', field())).toBe(true)
  expect(field()).toBeNull()
  expect(f.fake.called('rename')).toEqual([])
  await click(button('Rename Work'))
  await type(field(), 'Studio')
  await click(button('Save'))
  expect(f.fake.called('rename')).toEqual([['rename', 'work', 'Studio']])
  expect(card('work').querySelector('.accounts-name')!.textContent).toContain('Studio')
})

test('Sign in opens a terminal on that account’s own folder, and the panel gives way to it', async () => {
  const f = two()
  await open(f)
  await click(button('Sign in to Work'))
  expect(term.opened).toHaveLength(1)
  expect(term.opened[0].cwd).toBeUndefined()
  expect(term.opened[0].label).toBe('Sign in: Work')
  expect(term.opened[0].command).toContain('/Users/me/.claude-work')
  expect(term.opened[0].command).toMatch(/claude"?$/)
  expect(routeStore.getState().route.panel).toBeNull()
})

test('a terminal that would not open is said in place, and the panel stays', async () => {
  const f = two()
  await open(f)
  term.refuse = 'no terminal host yet'
  await click(button('Sign in to Work'))
  expect(document.querySelector('[role=alert]')!.textContent).toContain('Could not open a terminal to sign in to Work: no terminal host yet')
  expect(routeStore.getState().route.panel).toBe('accounts')
})

test('an account is added with the CLI chosen and the name typed, and the panel gives way to its login', async () => {
  const f = two()
  const added: unknown[][] = []
  const add = f.client.add
  f.client.add = (label, kind) => (added.push([label, kind]), add(label, kind))
  await open(f)
  await click(button('+ Add account'))
  expect(button('Add')!.disabled).toBe(true)
  await click(button('Grok Build'))
  await type(document.querySelector('[aria-label="New account\'s name"]'), 'Night')
  await click(button('Add'))
  await vi.waitFor(() => expect(routeStore.getState().route.panel).toBeNull())
  expect(added).toEqual([['Night', 'grok']])
  // Its login terminal opened on it, and the account that was active is active again.
  expect(f.fake.called('terminal')).toHaveLength(1)
  expect(f.fake.state.active).toBe('default')
})

test('what is wrong with an account is said on its card, with the way to share what it keeps apart', async () => {
  const f = fakeClient({
    state: { active: 'default', accounts: [account('default'), account('work', { problem: 'Not logged in yet.', unshared: ['settings.json'] })] },
    usage: { default: reading([limit('session', 5)]), work: 'this account has no login' },
  })
  await open(f)
  expect(card('work').querySelector('[data-problem]')!.textContent).toContain('Not logged in yet.')
  expect(card('work').textContent).toContain('No usage: this account has no login')
  await click(button('Share with the default account', card('work')))
  expect(f.fake.called('share')).toEqual([['share', 'work']])
  expect(button('Share with the default account')).toBeUndefined()
})

test('a list that cannot be read says what that means, and Retry reads it', async () => {
  const f = two()
  f.fake.refuse.list = 'accounts.json is not valid JSON'
  await open(f)
  expect(document.querySelector('[role=alert]')!.textContent).toContain('accounts.json is not valid JSON. Until it can, new sessions run on the default account.')
  delete f.fake.refuse.list
  await click(button('Retry'))
  await settle()
  await flush()
  expect(texts('.accounts-card .accounts-name')).toHaveLength(2)
})
