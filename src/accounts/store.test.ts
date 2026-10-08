import { createAccountsStore, LOGIN_CMD } from './store'
import { account, fakeClient, limit, reading, settle } from './testing'

const two = () => ({ active: 'default', accounts: [account('default', { label: 'Personal' }), account('work')] })

async function started(init: Parameters<typeof fakeClient>[0], pollMs?: number) {
  const { fake, client } = fakeClient(init)
  const store = createAccountsStore(client, { pollMs })
  store.getState().start()
  await settle()
  return { fake, store }
}

test('start reads the list, the panes and every account usage, once', async () => {
  const usage = { default: reading([limit('session', 34)]), work: reading([limit('session', 80)]) }
  const { fake, store } = await started({ state: two(), usage, panes: { 3: 'work' } })
  expect(store.getState().state?.accounts.map((a) => a.id)).toEqual(['default', 'work'])
  expect(store.getState().panes).toEqual({ 3: 'work' })
  expect(store.getState().usage.work.usage?.limits[0].percent).toBe(80)
  expect(fake.called('usage')).toEqual([
    ['usage', 'default', false],
    ['usage', 'work', false],
  ])
  store.getState().start()
  await settle()
  expect(fake.called('list')).toHaveLength(1)
})

test('without the accounts commands nothing is shown and nothing more is asked', async () => {
  const { fake, client } = fakeClient({ state: two() })
  fake.refuse.list = 'command accounts_list not found'
  const store = createAccountsStore(client)
  store.getState().start()
  await settle()
  expect(store.getState().state).toBeNull()
  expect(fake.calls.map((c) => c[0])).toEqual(['list'])
})

test('a usage that cannot be read says why, and keeps the reading it had', async () => {
  const { fake, store } = await started({ state: two(), usage: { default: reading([limit('session', 34)]), work: 'Credential refused.' } })
  expect(store.getState().usage.work).toEqual({ usage: null, error: 'Credential refused.', loading: false })
  fake.usage.default = 'No network.'
  await store.getState().readUsage(true)
  expect(store.getState().usage.default.error).toBe('No network.')
  expect(store.getState().usage.default.usage?.limits[0].percent).toBe(34)
})

test('switching sets the new state and reads every usage past the kept reading', async () => {
  const { fake, store } = await started({ state: two(), usage: {} })
  fake.calls.length = 0
  await store.getState().switchTo('work')
  expect(store.getState().state?.active).toBe('work')
  expect(fake.called('switch')).toEqual([['switch', 'work']])
  expect(fake.called('usage')).toEqual([
    ['usage', 'default', true],
    ['usage', 'work', true],
  ])
  expect(fake.called('panes')).toHaveLength(1)
})

test('a refused switch says why and leaves the active account', async () => {
  const { fake, store } = await started({ state: two() })
  fake.refuse.switch = 'Work is not logged in.'
  await store.getState().switchTo('work')
  expect(store.getState().error).toBe('Work is not logged in.')
  expect(store.getState().state?.active).toBe('default')
  store.getState().clearError()
  expect(store.getState().error).toBeNull()
})

test('accounts://changed brings the new state, the panes and the usage', async () => {
  const { fake, store } = await started({ state: two(), usage: { default: reading([]), work: reading([]) } })
  fake.calls.length = 0
  fake.panes = { 4: 'default' }
  fake.emit({ active: 'default', accounts: [account('default')] })
  await settle()
  expect(store.getState().state?.accounts).toHaveLength(1)
  expect(store.getState().panes).toEqual({ 4: 'default' })
  // The removed account's usage goes with it.
  expect(Object.keys(store.getState().usage)).toEqual(['default'])
  expect(fake.called('usage')).toEqual([['usage', 'default', false]])
})

test('usage is read again every poll', async () => {
  vi.useFakeTimers()
  try {
    const { fake, client } = fakeClient({ state: two(), usage: {} })
    const store = createAccountsStore(client, { pollMs: 1000 })
    store.getState().start()
    await vi.advanceTimersByTimeAsync(0)
    const before = fake.called('usage').length
    await vi.advanceTimersByTimeAsync(1000)
    expect(fake.called('usage').length).toBe(before + 2)
  } finally {
    vi.useRealTimers()
  }
})

test('adding opens a login terminal on the new account, then switches back', async () => {
  const { fake, store } = await started({ state: two() })
  fake.calls.length = 0
  const added = await store.getState().add('Side')
  expect(added?.id).toBe('side')
  expect(fake.calls.filter((c) => c[0] !== 'usage' && c[0] !== 'panes')).toEqual([
    ['add', 'Side'],
    ['switch', 'side'],
    ['terminal', LOGIN_CMD, 'side'],
    ['switch', 'default'],
  ])
  expect(store.getState().state?.active).toBe('default')
  expect(store.getState().state?.accounts.map((a) => a.id)).toEqual(['default', 'work', 'side'])
})

test('adding switches back even when the terminal fails to open', async () => {
  const { fake, store } = await started({ state: two() })
  fake.refuse.terminal = 'pty_spawn failed'
  expect(await store.getState().add('Side')).toBeNull()
  expect(store.getState().error).toBe('pty_spawn failed')
  expect(fake.state.active).toBe('default')
})

test('a refused add says why and opens no terminal', async () => {
  const { fake, store } = await started({ state: two() })
  fake.refuse.add = 'An account named Work exists.'
  expect(await store.getState().add('Work')).toBeNull()
  expect(store.getState().error).toBe('An account named Work exists.')
  expect(fake.called('terminal')).toHaveLength(0)
})

test('rename and remove apply the state they answer', async () => {
  const { fake, store } = await started({ state: two() })
  expect(await store.getState().rename('work', 'Job')).toBe(true)
  expect(store.getState().state?.accounts[1].label).toBe('Job')
  expect(await store.getState().remove('work')).toBe(true)
  expect(store.getState().state?.accounts.map((a) => a.id)).toEqual(['default'])
  fake.refuse.remove = 'The default account cannot be removed.'
  expect(await store.getState().remove('default')).toBe(false)
  expect(store.getState().error).toBe('The default account cannot be removed.')
})
