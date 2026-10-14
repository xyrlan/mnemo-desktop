import { vi } from 'vitest'
import type { FollowDeps } from './follow'
import { createAccountsStore, type FollowEnv } from './store'
import { account, fakeClient, settle } from './testing'

// The follow itself is `follow.test.ts`'s: here only what the store does with its `record`.
const seen = vi.hoisted(() => ({ deps: null as FollowDeps | null }))
vi.mock('./follow', () => ({
  createFollow: (d: FollowDeps) => {
    seen.deps = d
    return { switched: async () => {} }
  },
}))

test('a session that followed a switch but could not be recorded says so (#367)', async () => {
  const { fake, client } = fakeClient({ state: { active: 'work', accounts: [account('default'), account('work')] } })
  const store = createAccountsStore(client, { follow: {} as FollowEnv })
  store.getState().start()
  await settle()
  const record = seen.deps!.record

  await record(3, 'work')
  expect(store.getState().error).toBeNull()
  expect(fake.called('move')).toEqual([['move', 3, 'work']])

  fake.refuse.move = 'pane 4 moved to account `work`, but that could not be written'
  await expect(record(4, 'work')).rejects.toBe(fake.refuse.move)
  expect(store.getState().error).toBe('A session moved to Work, but the app could not record it: pane 4 moved to account `work`, but that could not be written')
})
