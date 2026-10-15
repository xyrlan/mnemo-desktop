import { vi } from 'vitest'
import { HIDDEN_MS, PRS_EVERY, startMissionPoll, VISIBLE_MS } from './mission-poll'
import { startTitleReload, TITLE_RELOAD_MS } from './title-reload'

describe('the mission poll', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function poll(hidden = false) {
    const calls: boolean[] = []
    const loadLooked = vi.fn(async () => {})
    const src = { refresh: vi.fn(async (withPrs: boolean) => void calls.push(withPrs)), loadLooked, hidden: () => hidden }
    return { calls, src, loadLooked }
  }

  test('refreshes every few seconds, asking for PRs on the first refresh and every tenth', async () => {
    const p = poll()
    const stop = startMissionPoll(p.src)
    expect(p.loadLooked).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(p.calls).toEqual([true])
    await vi.advanceTimersByTimeAsync(VISIBLE_MS * PRS_EVERY)
    expect(p.calls).toHaveLength(PRS_EVERY + 1)
    expect(p.calls.flatMap((prs, i) => (prs ? [i] : []))).toEqual([0, PRS_EVERY])
    stop()
    expect([VISIBLE_MS, HIDDEN_MS, PRS_EVERY]).toEqual([3000, 15000, 10])
  })

  test('slows down while the window is hidden', async () => {
    const p = poll(true)
    const stop = startMissionPoll(p.src)
    await vi.advanceTimersByTimeAsync(HIDDEN_MS - 1)
    expect(p.calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(p.calls).toHaveLength(2)
    stop()
  })

  test('a failed refresh does not stop it', async () => {
    const p = poll()
    p.src.refresh.mockRejectedValueOnce(new Error('gh down'))
    const stop = startMissionPoll(p.src)
    await vi.advanceTimersByTimeAsync(VISIBLE_MS)
    expect(p.src.refresh).toHaveBeenCalledTimes(2)
    stop()
  })

  test('stopped while a refresh is in flight, it schedules nothing more', async () => {
    let finish!: () => void
    const refresh = vi.fn(() => new Promise<void>((r) => (finish = r)))
    const stop = startMissionPoll({ refresh, loadLooked: async () => {}, hidden: () => false })
    stop()
    finish()
    await vi.advanceTimersByTimeAsync(VISIBLE_MS * 5)
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})

describe('Home titles for sessions it does not know', () => {
  function watch(init: { unknown: boolean; loading?: boolean }) {
    const state = { unknown: init.unknown, loading: init.loading ?? false, at: 0 }
    const listeners = new Set<() => void>()
    const load = vi.fn(async () => {})
    const stop = startTitleReload({
      unknown: () => state.unknown,
      loading: () => state.loading,
      load,
      onChange: (cb) => {
        listeners.add(cb)
        return () => void listeners.delete(cb)
      },
      now: () => state.at,
    })
    return { state, load, stop, listeners, change: () => listeners.forEach((l) => l()) }
  }

  test('are read again while a pane runs one, at most once a minute', () => {
    const w = watch({ unknown: true })
    expect(w.load).toHaveBeenCalledTimes(1)
    w.state.at = TITLE_RELOAD_MS - 1
    w.change()
    expect(w.load).toHaveBeenCalledTimes(1)
    w.state.at = TITLE_RELOAD_MS
    w.change()
    expect(w.load).toHaveBeenCalledTimes(2)
    expect(TITLE_RELOAD_MS).toBe(60_000)
  })

  test('are not read while every session is known, nor while Home is reading already', () => {
    const w = watch({ unknown: false })
    w.change()
    expect(w.load).not.toHaveBeenCalled()
    w.state.unknown = true
    w.state.loading = true
    w.change()
    expect(w.load).not.toHaveBeenCalled()
    w.state.loading = false
    w.change()
    expect(w.load).toHaveBeenCalledTimes(1)
    w.stop()
    expect(w.listeners.size).toBe(0)
  })
})
