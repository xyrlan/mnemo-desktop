import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { pollWhileShown, windowShown, type Shown } from './while-shown'

/** A window the test hides and shows. */
function fakeWindow() {
  let hidden = false
  const listeners = new Set<() => void>()
  const shown: Shown = {
    hidden: () => hidden,
    onShow(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
  }
  return {
    shown,
    listeners,
    hide: () => void (hidden = true),
    show: () => {
      hidden = false
      listeners.forEach((cb) => cb())
    },
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('pollWhileShown', () => {
  test('polls at once and every ms while the window shows', async () => {
    const w = fakeWindow()
    let n = 0
    const stop = pollWhileShown(() => n++, 1000, { shown: w.shown })
    await vi.advanceTimersByTimeAsync(0)
    expect(n).toBe(1)
    await vi.advanceTimersByTimeAsync(3000)
    expect(n).toBe(4)
    stop()
  })

  test('stops while the window is hidden and catches up the moment it shows', async () => {
    const w = fakeWindow()
    let n = 0
    const stop = pollWhileShown(() => n++, 1000, { shown: w.shown })
    await vi.advanceTimersByTimeAsync(0)
    w.hide()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(n).toBe(1)
    w.show()
    await vi.advanceTimersByTimeAsync(0)
    expect(n).toBe(2)
    // Then on its usual beat again.
    await vi.advanceTimersByTimeAsync(1000)
    expect(n).toBe(3)
    stop()
  })

  test('a window shown again before a poll is due does not poll early', async () => {
    const w = fakeWindow()
    let n = 0
    const stop = pollWhileShown(() => n++, 1000, { shown: w.shown })
    await vi.advanceTimersByTimeAsync(0)
    w.hide()
    await vi.advanceTimersByTimeAsync(400)
    w.show()
    await vi.advanceTimersByTimeAsync(0)
    expect(n).toBe(1)
    await vi.advanceTimersByTimeAsync(600)
    expect(n).toBe(2)
    stop()
  })

  test('with hiddenMs it slows down while hidden instead of stopping', async () => {
    const w = fakeWindow()
    let n = 0
    const stop = pollWhileShown(() => n++, 1000, { shown: w.shown, hiddenMs: 10_000 })
    await vi.advanceTimersByTimeAsync(0)
    w.hide()
    await vi.advanceTimersByTimeAsync(1000) // the beat already set
    expect(n).toBe(2)
    await vi.advanceTimersByTimeAsync(9_999)
    expect(n).toBe(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(n).toBe(3)
    stop()
  })

  test('wait leaves the first poll for later', async () => {
    const w = fakeWindow()
    let n = 0
    const stop = pollWhileShown(() => n++, 1000, { shown: w.shown, wait: true })
    await vi.advanceTimersByTimeAsync(999)
    expect(n).toBe(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(n).toBe(1)
    stop()
  })

  test('ticks never overlap, and a failed one does not stop it', async () => {
    const w = fakeWindow()
    const ends: (() => void)[] = []
    let n = 0
    const stop = pollWhileShown(
      () => {
        n++
        if (n === 2) throw new Error('busy')
        return new Promise<void>((r) => ends.push(r))
      },
      1000,
      { shown: w.shown },
    )
    await vi.advanceTimersByTimeAsync(5000)
    expect(n).toBe(1)
    ends[0]()
    await vi.advanceTimersByTimeAsync(1000)
    expect(n).toBe(2)
    await vi.advanceTimersByTimeAsync(1000)
    expect(n).toBe(3)
    stop()
  })

  test('stopped, it polls no more and stops listening', async () => {
    const w = fakeWindow()
    let n = 0
    const stop = pollWhileShown(() => n++, 1000, { shown: w.shown })
    await vi.advanceTimersByTimeAsync(0)
    stop()
    expect(w.listeners.size).toBe(0)
    await vi.advanceTimersByTimeAsync(5000)
    w.show()
    expect(n).toBe(1)
  })

  test('reads the document: hidden while visibilityState is, shown on visibilitychange', () => {
    const state = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    expect(windowShown.hidden()).toBe(true)
    const seen: string[] = []
    const off = windowShown.onShow(() => seen.push('shown'))
    document.dispatchEvent(new Event('visibilitychange'))
    state.mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    off()
    document.dispatchEvent(new Event('visibilitychange'))
    expect(seen).toEqual(['shown'])
    expect(windowShown.hidden()).toBe(false)
    state.mockRestore()
  })
})

// Every timer left in the app, read from disk. A new poll goes through `pollWhileShown` (or
// reads `document.hidden` itself, as the mission poll does); one that should
// run while nobody looks is named here with why. The app has no Node types: fs is typed here.
type Fs = {
  readdirSync(p: string, o: { withFileTypes: true }): { name: string; isDirectory(): boolean }[]
  readFileSync(p: string, e: 'utf8'): string
}
const fs = (await import(/* @vite-ignore */ `node:${'fs'}`)) as Fs
const cwd = (globalThis as unknown as { process: { cwd(): string } }).process.cwd()
function sources(dir = `${cwd}/src`): [string, string][] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e): [string, string][] => {
    const p = `${dir}/${e.name}`
    if (e.isDirectory()) return sources(p)
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [[p.slice(cwd.length + 1), fs.readFileSync(p, 'utf8')]] : []
  })
}

/** What may still `setInterval`, and why it starts no process or read. */
const UNPOLLED: Record<string, string> = {
  // Clocks: they move "3 min ago" on screen, nothing more.
  'src/conversation/ConversationView.tsx': 'clock',
}

test('every setInterval left in the app is a clock or named with why it runs while hidden', () => {
  const found = sources()
    .filter(([, text]) => /\bsetInterval\(/.test(text))
    .map(([p]) => p)
    .sort()
  expect(found).toEqual(Object.keys(UNPOLLED).sort())
})
