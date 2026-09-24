import { vi } from 'vitest'
import type { Action } from '../actions/registry'
import type { RepoNode, WorktreeNode } from '../fleet/types'
import { registerShellActions } from './actions'
import { createShellStore } from './store'
import { firstWorktree, keepAWorktreeShown } from './first-worktree'
import { HIDDEN_MS, PRS_EVERY, startMissionPoll, VISIBLE_MS } from './mission-poll'
import { startTitleReload, TITLE_RELOAD_MS } from './title-reload'
import { clampSidebarResizeWidth, getNextSidebarResizeWidth, getRenderedSidebarWidthCssValue } from './use-sidebar-resize'

describe('actions', () => {
  test('sidebar.toggle-left and sidebar.toggle-right open and close their sidebar', async () => {
    const shell = createShellStore()
    const actions: Action[] = []
    registerShellActions(shell, (a) => actions.push(a))
    expect(actions.map((a) => [a.id, a.shortcut])).toEqual([
      ['sidebar.toggle-left', '⌘B'],
      ['sidebar.toggle-right', '⌘L'],
    ])
    await actions[0].run()
    expect([shell.getState().leftOpen, shell.getState().rightOpen]).toEqual([false, true])
    await actions[1].run()
    expect([shell.getState().leftOpen, shell.getState().rightOpen]).toEqual([false, false])
  })
})

const wt = (path: string, kind: WorktreeNode['kind']): WorktreeNode => ({ path, name: path.split('/').pop()!, branch: 'main', kind, agents: [], pr: null, unread: false })
const repo = (root: string, worktrees: WorktreeNode[] = []): RepoNode => ({ root, name: root.split('/').pop()!, worktrees })

describe('the first worktree', () => {
  test('is the first repo’s main checkout, else its root; none without a repo', () => {
    expect(firstWorktree([repo('/r/a', [wt('/r/a-wt-x', 'workspace'), wt('/r/a', 'main')]), repo('/r/b', [wt('/r/b', 'main')])])).toBe('/r/a')
    expect(firstWorktree([repo('/r/a', [wt('/r/a-wt-x', 'dispatched')])])).toBe('/r/a')
    expect(firstWorktree([repo('/r/a')])).toBe('/r/a')
    expect(firstWorktree([])).toBeNull()
  })

  function sources(init: { shown: string | null; repos: RepoNode[] }) {
    const state = { ...init }
    const listeners = new Set<() => void>()
    const switched: string[] = []
    const emit = () => listeners.forEach((l) => l())
    return {
      state,
      switched,
      emit,
      listeners,
      src: {
        shown: () => state.shown,
        repos: () => state.repos,
        switchTo(path: string) {
          switched.push(path)
          state.shown = path
          // The layout store tells its subscribers synchronously, from inside this call.
          emit()
        },
        onChange(cb: () => void) {
          listeners.add(cb)
          return () => void listeners.delete(cb)
        },
      },
    }
  }

  test('shows as soon as the fleet knows a repo, when nothing is shown', () => {
    const s = sources({ shown: null, repos: [] })
    keepAWorktreeShown(s.src)
    expect(s.switched).toEqual([])
    s.state.repos = [repo('/r/a', [wt('/r/a', 'main')])]
    s.emit()
    expect(s.switched).toEqual(['/r/a'])
  })

  test('leaves a chosen worktree alone', () => {
    const s = sources({ shown: '/r/b-wt-1', repos: [repo('/r/a')] })
    keepAWorktreeShown(s.src)
    s.emit()
    expect(s.switched).toEqual([])
  })

  test('shows it again when the last open worktree closes, and stops when told', () => {
    const s = sources({ shown: '/r/b-wt-1', repos: [repo('/r/a')] })
    const stop = keepAWorktreeShown(s.src)
    s.state.shown = null
    s.emit()
    expect(s.switched).toEqual(['/r/a'])
    stop()
    expect(s.listeners.size).toBe(0)
  })
})

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

describe('sidebar resize geometry', () => {
  test('a drag widens a left sidebar to the right and a right sidebar to the left, within bounds', () => {
    const base = { startX: 300, startWidth: 280, minWidth: 220, maxWidth: 500 }
    expect(getNextSidebarResizeWidth({ ...base, clientX: 340, deltaSign: 1 })).toBe(320)
    expect(getNextSidebarResizeWidth({ ...base, clientX: 340, deltaSign: -1 })).toBe(240)
    expect(getNextSidebarResizeWidth({ ...base, clientX: 0, deltaSign: 1 })).toBe(220)
    expect(getNextSidebarResizeWidth({ ...base, clientX: 2000, deltaSign: 1 })).toBe(500)
    expect(clampSidebarResizeWidth(100, 220, 500)).toBe(220)
  })

  test('a closed sidebar is drawn 0 wide whatever its width', () => {
    expect(getRenderedSidebarWidthCssValue(true, 280)).toBe('280px')
    expect(getRenderedSidebarWidthCssValue(false, 280)).toBe('0px')
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
