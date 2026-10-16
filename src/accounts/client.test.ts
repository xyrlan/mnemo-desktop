import { account } from './testing'

/** What `invoke` was asked, by a plain recorder (memory vitest5-spy-rejecting-a-string-fails-the-test). */
const asked: [string, unknown][] = []
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args: unknown) => {
    asked.push([cmd, args])
    return cmd === 'accounts_add' ? account('x') : { limits: [], plan: null, fetchedAt: 0, stale: null }
  },
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))

const { tauriAccounts } = await import('./client')

beforeEach(() => void (asked.length = 0))

test("usage asks plan_usage with the account's kind, so a Grok account is never read as Claude's", async () => {
  await tauriAccounts.usage(account('side', { kind: 'grok', configDir: '/Users/me/.grok-side' }), true)
  await tauriAccounts.usage(account('work', { kind: 'claude' }), false)
  expect(asked).toEqual([
    ['plan_usage', { configDir: '/Users/me/.grok-side', isDefault: false, kind: 'grok', refresh: true }],
    ['plan_usage', { configDir: '/Users/me/.claude-work', isDefault: false, kind: 'claude', refresh: false }],
  ])
})

test('add passes the kind, Claude when none is given', async () => {
  await tauriAccounts.add('Grok', 'grok')
  await tauriAccounts.add('Work')
  expect(asked).toEqual([
    ['accounts_add', { label: 'Grok', kind: 'grok' }],
    ['accounts_add', { label: 'Work', kind: 'claude' }],
  ])
})
