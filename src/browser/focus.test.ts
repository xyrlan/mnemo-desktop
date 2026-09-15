import type { Bounds } from './client'
import { focusedEvent, pageAt, toViewport, watchPageFocus, type FocusHost, type Point } from './focus'

const b = (x: number, y: number, w: number, h: number): Bounds => ({ x, y, w, h })
const HIDDEN = b(0, 0, 0, 0)

test('the event names the pane', () => {
  expect(focusedEvent(-4)).toBe('browser://focused/-4')
})

test('the cursor picks the page it is over', () => {
  const pages: [number, Bounds][] = [
    [-1, b(0, 40, 400, 300)],
    [-2, b(410, 40, 400, 300)],
  ]
  expect(pageAt({ x: 10, y: 50 }, pages)).toBe(-1)
  expect(pageAt({ x: 420, y: 339 }, pages)).toBe(-2)
  expect(pageAt({ x: 405, y: 50 }, pages)).toBeNull()
  expect(pageAt({ x: 400, y: 50 }, pages)).toBeNull()
  expect(pageAt({ x: 10, y: 39 }, pages)).toBeNull()
})

test('hidden pages never match, and one visible page stands in for an unknown cursor', () => {
  expect(pageAt({ x: 0, y: 0 }, [[-1, HIDDEN]])).toBeNull()
  expect(pageAt(null, [[-1, HIDDEN], [-2, b(0, 40, 10, 10)]])).toBe(-2)
  expect(pageAt(null, [[-1, b(0, 0, 10, 10)], [-2, b(0, 40, 10, 10)]])).toBeNull()
  expect(pageAt({ x: 500, y: 500 }, [[-2, b(0, 40, 10, 10)]])).toBeNull()
})

test('screen cursor lands in viewport pixels below the titlebar', () => {
  // Retina window at (100, 50) logical whose 800 px content view has a 28 px titlebar.
  const p = toViewport({
    cursor: { x: 2 * 150, y: 2 * 128 },
    cursorScale: 2,
    inner: { x: 200, y: 100 },
    innerHeight: 1600,
    scale: 2,
    viewportHeight: 772,
  })
  expect(p).toEqual({ x: 50, y: 50 })
  // No titlebar inset, and a cursor scaled by a different primary monitor.
  expect(toViewport({ cursor: { x: 150, y: 90 }, cursorScale: 1, inner: { x: 200, y: 100 }, innerHeight: 800, scale: 2, viewportHeight: 400 })).toEqual({
    x: 50,
    y: 40,
  })
})

function fakeHost(o: { windowFocused?: boolean; cursor?: Point | null } = {}) {
  let blur = () => {}
  let windowFocus = () => {}
  const state = { doc: false, win: o.windowFocused ?? true, cursor: o.cursor === undefined ? { x: 10, y: 50 } : o.cursor }
  const emitted: string[] = []
  const offBlur = vi.fn()
  const offWindow = vi.fn()
  const host: FocusHost = {
    windowFocused: async () => state.win,
    cursor: async () => state.cursor,
    documentFocused: () => state.doc,
    onBlur: (cb) => {
      blur = cb
      return offBlur
    },
    onWindowFocus: async (cb) => {
      windowFocus = cb
      return offWindow
    },
    emit: (e) => emitted.push(e),
  }
  return { host, state, emitted, offBlur, offWindow, blur: () => blur(), windowFocus: () => windowFocus() }
}

const pages = (): [number, Bounds][] => [
  [-1, b(0, 40, 400, 300)],
  [-2, b(410, 40, 400, 300)],
]
const settle = () => new Promise((r) => setTimeout(r, 0))

test('the document blurring over a page focuses that pane', async () => {
  const f = fakeHost()
  watchPageFocus(f.host, pages)
  f.blur()
  await settle()
  expect(f.emitted).toEqual(['browser://focused/-1'])
})

test('a blur from leaving the app, or away from any page, focuses nothing', async () => {
  const away = fakeHost({ windowFocused: false })
  watchPageFocus(away.host, pages)
  away.blur()
  const elsewhere = fakeHost({ cursor: { x: 900, y: 900 } })
  watchPageFocus(elsewhere.host, pages)
  elsewhere.blur()
  await settle()
  expect(away.emitted).toEqual([])
  expect(elsewhere.emitted).toEqual([])
})

test('focus that is back in the document by the time the cursor is read wins', async () => {
  const f = fakeHost()
  f.host.cursor = async () => {
    f.state.doc = true
    return { x: 10, y: 50 }
  }
  watchPageFocus(f.host, pages)
  f.blur()
  await settle()
  expect(f.emitted).toEqual([])
})

test('a blur while the document still has focus asks nothing of the window', async () => {
  const f = fakeHost()
  f.state.doc = true
  const asked = vi.fn(async () => true)
  f.host.windowFocused = asked
  f.host.cursor = asked as never
  watchPageFocus(f.host, pages)
  f.blur()
  await settle()
  expect(asked).not.toHaveBeenCalled()
  expect(f.emitted).toEqual([])
})

test('the window gaining focus straight into a page focuses that pane', async () => {
  vi.useFakeTimers()
  try {
    const f = fakeHost({ cursor: { x: 420, y: 60 } })
    watchPageFocus(f.host, pages)
    await vi.advanceTimersByTimeAsync(0)
    f.windowFocus()
    await vi.advanceTimersByTimeAsync(49)
    expect(f.emitted).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(f.emitted).toEqual(['browser://focused/-2'])

    // Activation that puts focus back in the document does not.
    f.state.doc = true
    f.windowFocus()
    await vi.advanceTimersByTimeAsync(50)
    expect(f.emitted).toEqual(['browser://focused/-2'])
  } finally {
    vi.useRealTimers()
  }
})

test('unsubscribing stops listening and drops checks in flight', async () => {
  vi.useFakeTimers()
  try {
    const f = fakeHost()
    const stop = watchPageFocus(f.host, pages)
    await vi.advanceTimersByTimeAsync(0)
    f.windowFocus()
    f.blur()
    stop()
    await vi.advanceTimersByTimeAsync(100)
    expect(f.emitted).toEqual([])
    expect(f.offBlur).toHaveBeenCalledTimes(1)
    expect(f.offWindow).toHaveBeenCalledTimes(1)
  } finally {
    vi.useRealTimers()
  }
})
