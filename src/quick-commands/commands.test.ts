import { cleaned, commandsFor, createQuickCommands, focusedTerminal, keystrokes, repoOf, withAdded, withEdited, withRemoved, type QuickCommands } from './commands'

const R = '/code/app'
const dev = { label: 'Dev', command: 'pnpm dev' }
const test_ = { label: 'Test', command: 'pnpm test' }

describe('commandsFor', () => {
  test("a repo's list, in order", () => {
    expect(commandsFor({ [R]: [dev, test_] }, R)).toEqual([dev, test_])
  })
  test('the same empty array for no repo, an unknown repo, and no record at all', () => {
    const none = commandsFor(undefined, null)
    expect(none).toEqual([])
    expect(commandsFor({}, R)).toBe(none)
    expect(commandsFor({ other: [dev] }, R)).toBe(none)
    expect(commandsFor(undefined, R)).toBe(none)
  })
  test('the stored array itself, so a selector returning it is stable', () => {
    const all = { [R]: [dev] }
    expect(commandsFor(all, R)).toBe(all[R])
  })
})

describe('cleaned', () => {
  test('trims the label and the end of the command, keeping its start', () => {
    expect(cleaned({ label: '  Dev ', command: '  pnpm dev \n' })).toEqual({ label: 'Dev', command: '  pnpm dev' })
  })
  test('null without a label or a command', () => {
    expect(cleaned({ label: ' ', command: 'x' })).toBeNull()
    expect(cleaned({ label: 'x', command: ' \n ' })).toBeNull()
  })
})

describe('editing the record', () => {
  test('adds at the end of the repo, leaving other repos alone', () => {
    const all: QuickCommands = { other: [test_] }
    expect(withAdded(all, R, dev)).toEqual({ other: [test_], [R]: [dev] })
    expect(withAdded({ [R]: [dev] }, R, test_)).toEqual({ [R]: [dev, test_] })
    expect(all).toEqual({ other: [test_] })
  })
  test('edits one command in place', () => {
    expect(withEdited({ [R]: [dev, test_] }, R, 1, { label: 'T', command: 'vitest' })).toEqual({ [R]: [dev, { label: 'T', command: 'vitest' }] })
  })
  test('an edit or removal of an index that is not there changes nothing', () => {
    const all = { [R]: [dev] }
    expect(withEdited(all, R, 1, test_)).toBe(all)
    expect(withEdited(all, R, -1, test_)).toBe(all)
    expect(withRemoved(all, R, 3)).toBe(all)
  })
  test('removes one; a repo left with none leaves the record', () => {
    expect(withRemoved({ [R]: [dev, test_] }, R, 0)).toEqual({ [R]: [test_] })
    expect(withRemoved({ [R]: [dev], other: [test_] }, R, 0)).toEqual({ other: [test_] })
  })
})

test('keystrokes: the command and a carriage return', () => {
  expect(keystrokes(dev)).toBe('pnpm dev\r')
})

describe('focusedTerminal', () => {
  const tabs = [
    { id: 'a', focused: 1 },
    { id: 'b', focused: -2 },
    { id: 'c', focused: 3 },
  ]
  const panes = { 1: { view: 'terminal' }, [-2]: { view: 'browser' }, 3: { view: 'editor' } }
  test("the shown tab's focused pane when it is a terminal", () => {
    expect(focusedTerminal({ tabs, activeTab: 'a', panes })).toBe(1)
  })
  test('null for another view, no tab shown, or a pane that is gone', () => {
    expect(focusedTerminal({ tabs, activeTab: 'b', panes })).toBeNull()
    expect(focusedTerminal({ tabs, activeTab: 'c', panes })).toBeNull()
    expect(focusedTerminal({ tabs, activeTab: '', panes })).toBeNull()
    expect(focusedTerminal({ tabs, activeTab: 'a', panes: {} })).toBeNull()
  })
})

test('repoOf: the root of the repo holding a worktree, main or not', () => {
  const repos = [{ root: R, worktrees: [{ path: R }, { path: `${R}-wt-x` }] }]
  expect(repoOf(repos, R)).toBe(R)
  expect(repoOf(repos, `${R}-wt-x`)).toBe(R)
  expect(repoOf(repos, '/elsewhere')).toBeNull()
  expect(repoOf(repos, null)).toBeNull()
})

describe('createQuickCommands', () => {
  function setup(focused: number | null = null, initial: QuickCommands = {}) {
    let all = initial
    const calls: string[] = []
    const qc = createQuickCommands({
      read: () => all,
      write: async (next) => void (all = next),
      focused: () => focused,
      writePty: async (pane, data) => void calls.push(`pty ${pane} ${JSON.stringify(data)}`),
      openCommandTab: async (cmd) => void calls.push(`tab ${cmd}`),
    })
    return { qc, calls, all: () => all }
  }

  test('runs in the focused terminal, with Enter', async () => {
    const { qc, calls } = setup(7)
    await qc.run(dev)
    expect(calls).toEqual(['pty 7 "pnpm dev\\r"'])
  })
  test('with no terminal focused, opens a tab running it', async () => {
    const { qc, calls } = setup(null)
    await qc.run(dev)
    expect(calls).toEqual(['tab pnpm dev'])
  })
  test('a failed write reaches the caller', async () => {
    const qc = createQuickCommands({
      read: () => ({}),
      write: async () => {},
      focused: () => 1,
      writePty: () => Promise.reject(new Error('pane is gone')),
      openCommandTab: async () => {},
    })
    await expect(qc.run(dev)).rejects.toThrow('pane is gone')
  })
  test('add, edit and remove save per repo', async () => {
    const { qc, all } = setup(null, { other: [test_] })
    expect(await qc.add(R, { label: ' Dev ', command: 'pnpm dev  ' })).toBe(true)
    expect(all()).toEqual({ other: [test_], [R]: [dev] })
    expect(await qc.edit(R, 0, { label: 'Dev', command: 'pnpm dev --host' })).toBe(true)
    expect(all()[R]).toEqual([{ label: 'Dev', command: 'pnpm dev --host' }])
    await qc.remove(R, 0)
    expect(all()).toEqual({ other: [test_] })
  })
  test('a draft with nothing in it is not saved', async () => {
    const { qc, all } = setup(null, { [R]: [dev] })
    expect(await qc.add(R, { label: '', command: 'x' })).toBe(false)
    expect(await qc.edit(R, 0, { label: 'x', command: '' })).toBe(false)
    expect(all()).toEqual({ [R]: [dev] })
  })
})
