import { cleaned, commandsFor, withAdded, withEdited, withRemoved, type QuickCommands } from './commands'

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

test('a repo’s key is compared as a path: one spelling finds and changes the list another saved', () => {
  const all = { 'C:\\Users\\you\\repo': [dev] }
  expect(commandsFor(all, 'c:/Users/you/repo/')).toEqual([dev])
  expect(withAdded(all, 'c:\\Users\\you\\repo', test_)).toEqual({ 'C:\\Users\\you\\repo': [dev, test_] })
  expect(withRemoved(all, 'c:\\Users\\you\\repo', 0)).toEqual({})
  expect(commandsFor(all, 'C:\\Users\\you\\other')).toBe(commandsFor(undefined, 'x'))
})
