import { createCockpitStore, MAX_LINES } from './store'

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

test('a row runs one job at a time; a second start while it runs changes nothing', () => {
  const s = createCockpitStore()
  expect(s.getState().jobStart(MERGE, 'merge · PR #412')).toBe(true)
  s.getState().jobLine(MERGE, { stream: 'out', line: 'a' })
  expect(s.getState().jobStart(MERGE, 'merge · PR #412')).toBe(false)
  expect(s.getState().jobs[MERGE].lines).toEqual([{ stream: 'out', line: 'a' }])
  s.getState().jobExit(MERGE, 1)
  // Once it ended, a retry starts a fresh log.
  expect(s.getState().jobStart(MERGE, 'merge · PR #412')).toBe(true)
  expect(s.getState().jobs[MERGE]).toEqual({ title: 'merge · PR #412', lines: [], running: true, code: null })
})

test('success is silence; a failure, or a signal, opens its own drawer', () => {
  const s = createCockpitStore()
  s.getState().jobStart(MERGE, 'm')
  s.getState().jobExit(MERGE, 0)
  expect(s.getState().drawer).toBeNull()
  expect(s.getState().jobs[MERGE]).toMatchObject({ running: false, code: 0 })
  for (const code of [2, null]) {
    s.setState({ drawer: CHAT })
    s.getState().jobStart(MERGE, 'm')
    s.getState().jobExit(MERGE, code)
    expect(s.getState().drawer).toBe(MERGE)
  }
  s.getState().jobStart(MERGE, 'm')
  s.getState().closeDrawer()
  s.getState().jobFailed(MERGE, 'gh not found in PATH')
  expect(s.getState().drawer).toBe(MERGE)
  expect(s.getState().jobs[MERGE]).toMatchObject({ running: false, error: 'gh not found in PATH' })
})

test("events for a job that is not running are another run's, and are dropped", () => {
  const s = createCockpitStore()
  s.getState().jobLine(MERGE, { stream: 'out', line: 'nobody asked' })
  s.getState().jobExit(MERGE, 1)
  expect(s.getState().jobs).toEqual({})
  expect(s.getState().drawer).toBeNull()
  s.getState().jobStart(MERGE, 'm')
  s.getState().jobExit(MERGE, 0)
  s.getState().jobLine(MERGE, { stream: 'err', line: 'late' })
  s.getState().jobExit(MERGE, 1)
  expect(s.getState().jobs[MERGE]).toMatchObject({ lines: [], code: 0 })
  expect(s.getState().drawer).toBeNull()
})

test('a talkative job keeps its last lines', () => {
  const s = createCockpitStore()
  s.getState().jobStart(MERGE, 'm')
  for (let i = 0; i < MAX_LINES + 3; i++) s.getState().jobLine(MERGE, { stream: 'out', line: String(i) })
  const lines = s.getState().jobs[MERGE].lines
  expect(lines).toHaveLength(MAX_LINES)
  expect(lines[0].line).toBe('3')
  expect(lines.at(-1)!.line).toBe(String(MAX_LINES + 2))
})
