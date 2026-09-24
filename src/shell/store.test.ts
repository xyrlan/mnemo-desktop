import { createShellStore, DEFAULTS, LEFT_MAX, LEFT_MIN, readKept, RIGHT_MAX, RIGHT_MIN, rightMaxFor, rightWidthFor, STORAGE_KEY, WORKBENCH_MIN, shellStore, useShell } from './store'

function memory(initial?: string) {
  const kept = new Map<string, string>(initial === undefined ? [] : [[STORAGE_KEY, initial]])
  return { kept, storage: { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) } }
}

test('a first launch opens both sidebars at their default widths', () => {
  const s = createShellStore(memory().storage).getState()
  expect({ leftOpen: s.leftOpen, rightOpen: s.rightOpen, leftWidth: s.leftWidth, rightWidth: s.rightWidth }).toEqual(DEFAULTS)
  expect(DEFAULTS).toEqual({ leftOpen: true, rightOpen: true, leftWidth: 280, rightWidth: 320 })
})

test('each toggle flips its own sidebar only', () => {
  const s = createShellStore()
  s.getState().toggleLeft()
  expect([s.getState().leftOpen, s.getState().rightOpen]).toEqual([false, true])
  s.getState().toggleRight()
  expect([s.getState().leftOpen, s.getState().rightOpen]).toEqual([false, false])
  s.getState().toggleLeft()
  expect([s.getState().leftOpen, s.getState().rightOpen]).toEqual([true, false])
})

test('widths are clamped to Orca’s bounds and rounded to whole pixels', () => {
  const s = createShellStore()
  s.getState().setLeftWidth(10)
  expect(s.getState().leftWidth).toBe(LEFT_MIN)
  s.getState().setLeftWidth(9999)
  expect(s.getState().leftWidth).toBe(LEFT_MAX)
  s.getState().setLeftWidth(300.6)
  expect(s.getState().leftWidth).toBe(301)
  s.getState().setRightWidth(0)
  expect(s.getState().rightWidth).toBe(RIGHT_MIN)
  s.getState().setRightWidth(1e6)
  expect(s.getState().rightWidth).toBe(RIGHT_MAX)
  s.getState().setRightWidth(444)
  expect(s.getState().rightWidth).toBe(444)
  expect([LEFT_MIN, LEFT_MAX, RIGHT_MIN]).toEqual([220, 500, 220])
})

test('what changes is kept, and the next launch starts from it', () => {
  const { kept, storage } = memory()
  const s = createShellStore(storage)
  s.getState().toggleRight()
  s.getState().setLeftWidth(333)
  expect(JSON.parse(kept.get(STORAGE_KEY)!)).toEqual({ leftOpen: true, rightOpen: false, leftWidth: 333, rightWidth: 320 })
  const next = createShellStore(storage).getState()
  expect([next.leftOpen, next.rightOpen, next.leftWidth, next.rightWidth]).toEqual([true, false, 333, 320])
})

test('a write that changes nothing is not stored again', () => {
  const setItem = vi.fn()
  const s = createShellStore({ getItem: () => null, setItem })
  s.getState().setLeftWidth(DEFAULTS.leftWidth)
  expect(setItem).not.toHaveBeenCalled()
  s.getState().setLeftWidth(DEFAULTS.leftWidth + 1)
  expect(setItem).toHaveBeenCalledTimes(1)
})

test('storage that refuses reads or writes leaves a working shell', () => {
  const s = createShellStore({
    getItem: () => {
      throw new Error('denied')
    },
    setItem: () => {
      throw new Error('full')
    },
  })
  expect(s.getState().leftWidth).toBe(DEFAULTS.leftWidth)
  s.getState().toggleLeft()
  expect(s.getState().leftOpen).toBe(false)
})

test('a kept file that is malformed or out of bounds falls back field by field', () => {
  expect(readKept(null)).toEqual(DEFAULTS)
  expect(readKept('not json')).toEqual(DEFAULTS)
  expect(readKept('[1,2]')).toEqual(DEFAULTS)
  expect(readKept(JSON.stringify({ leftOpen: 'yes', rightOpen: false, leftWidth: 5000, rightWidth: 'wide' }))).toEqual({
    leftOpen: true,
    rightOpen: false,
    leftWidth: LEFT_MAX,
    rightWidth: DEFAULTS.rightWidth,
  })
  expect(readKept(JSON.stringify({ leftWidth: null, rightWidth: 1 }))).toEqual({ ...DEFAULTS, rightWidth: RIGHT_MIN })
})

test('on screen the right sidebar leaves the workbench its minimum, but is never narrower than its own', () => {
  expect(WORKBENCH_MIN).toBe(320)
  // 1440 − 280 − 320 = 840 of room: the stored width stands.
  expect(rightMaxFor(1440, 280)).toBe(840)
  expect(rightWidthFor(400, 1440, 280)).toBe(400)
  // 1000 − 280 − 320 = 400: a 600 px sidebar is drawn at 400.
  expect(rightWidthFor(600, 1000, 280)).toBe(400)
  // A closed left sidebar takes nothing.
  expect(rightWidthFor(600, 1000, 0)).toBe(600)
  // A window too small for both: the sidebar's own minimum wins.
  expect(rightMaxFor(600, 280)).toBe(RIGHT_MIN)
  expect(rightWidthFor(500, 600, 280)).toBe(RIGHT_MIN)
  expect(rightMaxFor(10_000, 0)).toBe(RIGHT_MAX)
})

test('the app’s store and hook are the contract’s', () => {
  expect(typeof shellStore.getState().toggleLeft).toBe('function')
  expect(typeof useShell).toBe('function')
})
