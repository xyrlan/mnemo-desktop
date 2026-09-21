import { createCockpitStore } from './store'

const MERGE = 'ready:412'
const CHAT = 'working:aa000001'

test('no drawer is open until a row opens one', () => {
  expect(createCockpitStore().getState().drawer).toBeNull()
})

test("another row's drawer swaps the content, it never stacks", () => {
  const s = createCockpitStore()
  s.getState().openDrawer(MERGE)
  expect(s.getState().drawer).toBe(MERGE)
  s.getState().openDrawer(CHAT)
  // One slot, not a list: there is no second drawer for the first row to still be in.
  expect(s.getState().drawer).toBe(CHAT)
})

test('a row that is already showing closes on a second click, and another row swaps', () => {
  const s = createCockpitStore()
  s.getState().toggleDrawer(MERGE)
  expect(s.getState().drawer).toBe(MERGE)
  s.getState().toggleDrawer(MERGE)
  expect(s.getState().drawer).toBeNull()
  s.getState().toggleDrawer(MERGE)
  s.getState().toggleDrawer(CHAT)
  expect(s.getState().drawer).toBe(CHAT)
})

test('closing shuts the window and touches nothing behind it', () => {
  const s = createCockpitStore()
  s.getState().openDrawer(MERGE)
  // Every other field, whatever the store grows (a job's lines, a conversation), must come
  // through a close unchanged: a drawer is a window onto work, not its lifetime.
  const behind = { ...s.getState(), drawer: null }
  s.getState().closeDrawer()
  expect(s.getState()).toEqual(behind)
  expect(s.getState().drawer).toBeNull()
})
