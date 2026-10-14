import { BEAT_MS, startNexusUsage } from './usage'

let t = 0
const now = () => t
let focused = true
let visibility: DocumentVisibilityState = 'visible'

beforeEach(() => {
  vi.useFakeTimers()
  t = 1_000_000
  focused = true
  visibility = 'visible'
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused)
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Moves the clock and the timers together. */
const pass = (ms: number) => {
  t += ms
  vi.advanceTimersByTime(ms)
}
const blur = () => {
  focused = false
  window.dispatchEvent(new Event('blur'))
}
const focus = () => {
  focused = true
  window.dispatchEvent(new Event('focus'))
}
const hide = () => {
  visibility = 'hidden'
  document.dispatchEvent(new Event('visibilitychange'))
}
const show = () => {
  visibility = 'visible'
  document.dispatchEvent(new Event('visibilitychange'))
}

test('open is logged once, and the time on screen every beat and once more at stop', () => {
  const rows: Record<string, unknown>[] = []
  const stop = startNexusUsage((r) => rows.push(r), now)
  expect(rows).toEqual([{ event: 'nexus.open' }])
  pass(BEAT_MS)
  pass(BEAT_MS)
  pass(4_000)
  stop()
  expect(rows).toEqual([
    { event: 'nexus.open' },
    { event: 'nexus.visible', ms: BEAT_MS },
    { event: 'nexus.visible', ms: BEAT_MS },
    { event: 'nexus.visible', ms: 4_000 },
  ])
  // Stopped: no more beats, and a second stop writes nothing.
  pass(BEAT_MS * 3)
  stop()
  expect(rows).toHaveLength(4)
})

test('time with the window blurred or hidden is not counted', () => {
  const rows: Record<string, unknown>[] = []
  const stop = startNexusUsage((r) => rows.push(r), now)
  pass(5_000)
  blur()
  pass(10_000)
  focus()
  pass(2_000)
  hide()
  pass(10_000)
  show()
  pass(1_000)
  stop()
  // Each stretch seen is written when it ends.
  const visible = rows.filter((r) => r.event === 'nexus.visible')
  expect(visible).toEqual([
    { event: 'nexus.visible', ms: 5_000 },
    { event: 'nexus.visible', ms: 2_000 },
    { event: 'nexus.visible', ms: 1_000 },
  ])
})

test('no timer runs while the drawer is not seen', () => {
  const rows: Record<string, unknown>[] = []
  const stop = startNexusUsage((r) => rows.push(r), now)
  hide()
  expect(vi.getTimerCount()).toBe(0)
  show()
  expect(vi.getTimerCount()).toBe(1)
  stop()
  expect(vi.getTimerCount()).toBe(0)
})

test('a beat counts only the time since the stretch began', () => {
  const rows: Record<string, unknown>[] = []
  const stop = startNexusUsage((r) => rows.push(r), now)
  pass(10_000)
  blur()
  pass(BEAT_MS)
  focus()
  pass(BEAT_MS)
  stop()
  expect(rows.slice(1)).toEqual([
    { event: 'nexus.visible', ms: 10_000 },
    { event: 'nexus.visible', ms: BEAT_MS },
  ])
})

test('a beat with nothing seen writes no row', () => {
  focused = false
  const rows: Record<string, unknown>[] = []
  const stop = startNexusUsage((r) => rows.push(r), now)
  pass(BEAT_MS * 2)
  stop()
  expect(rows).toEqual([{ event: 'nexus.open' }])
})

test('opened in a background window, it counts from the moment the window is focused', () => {
  focused = false
  const rows: Record<string, unknown>[] = []
  const stop = startNexusUsage((r) => rows.push(r), now)
  pass(7_000)
  focus()
  pass(3_000)
  stop()
  expect(rows.at(-1)).toEqual({ event: 'nexus.visible', ms: 3_000 })
})
