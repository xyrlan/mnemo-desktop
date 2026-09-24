import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createStore } from 'zustand/vanilla'
import type { ScmState } from './store'
import { currentWorktree, pickInDiff, pickRightbarTab, serialWatch, useLiveChanges, type LiveDeps } from './live'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('currentWorktree', () => {
  const repos = [{ worktrees: [{ path: '/code/app' }, { path: '/code/app/.wt/feat/' }] }]
  const layout = (activeWorktree: string | null, cwd?: string) => ({ activeWorktree, activeTab: 't', tabs: [{ id: 't', focused: 1 }], panes: { 1: { cwd } } })

  it('is the worktree on screen', () => {
    expect(currentWorktree(layout('/code/other', '/code/app'), repos)).toBe('/code/other')
  })

  it('before one is chosen, is the deepest worktree the focused pane is in', () => {
    expect(currentWorktree(layout(null, '/code/app/.wt/feat/src'), repos)).toBe('/code/app/.wt/feat')
    expect(currentWorktree(layout(null, '/code/app/src'), repos)).toBe('/code/app')
    expect(currentWorktree(layout(null, '/tmp/loose'), repos)).toBe('/tmp/loose')
    expect(currentWorktree(layout(null), repos)).toBeNull()
  })
})

it('serialWatch starts each watch call only once the one before is done', async () => {
  const order: string[] = []
  let release!: () => void
  const watch = serialWatch({
    watch: (w) => {
      order.push(`start ${w}`)
      return w === 'a' ? new Promise<void>((r) => (release = () => (order.push('end a'), r()))) : Promise.reject('no watch')
    },
  })
  const a = watch('a')
  const none = watch(null)
  const b = watch('b')
  await new Promise((r) => setTimeout(r, 0))
  expect(order).toEqual(['start a'])
  release()
  await a
  await expect(none).rejects.toBe('no watch')
  await expect(b).rejects.toBe('no watch')
  expect(order).toEqual(['start a', 'end a', 'start null', 'start b'])
})

describe('useLiveChanges', () => {
  let root: Root
  let host: HTMLElement
  const loads: string[] = []
  const store = createStore<ScmState>(() => ({ load: async (w: string) => void loads.push(w) }) as unknown as ScmState)
  let changed: (() => void) | null
  let unlistened: number
  let commitClosed: (() => void) | null
  let watched: (string | null)[]
  let watchFails: boolean

  const deps = (): LiveDeps => ({
    client: {
      onChanged: async (on) => {
        changed = () => on('/root')
        return () => void unlistened++
      },
    },
    watch: async (w) => {
      watched.push(w)
      if (watchFails && w) throw 'too many folders to watch'
    },
    onCommitClosed: (on) => {
      commitClosed = on
      return () => (commitClosed = null)
    },
    pollMs: 1_000,
  })

  function Probe({ worktree, d }: { worktree: string | null; d: LiveDeps }) {
    useLiveChanges(worktree, store, d)
    return null
  }

  beforeEach(() => {
    loads.length = 0
    changed = null
    unlistened = 0
    commitClosed = null
    watched = []
    watchFails = false
    host = document.body.appendChild(document.createElement('div'))
    root = createRoot(host)
  })
  afterEach(() => {
    vi.useRealTimers()
    host.remove()
  })

  it('reads on showing, when the watch says so, when the window comes back and when the composer closes', async () => {
    const d = deps()
    await act(async () => root.render(<Probe worktree="/wt" d={d} />))
    expect(loads).toEqual(['/wt'])
    expect(watched).toEqual(['/wt'])
    await act(async () => changed!())
    await act(async () => void window.dispatchEvent(new Event('focus')))
    await act(async () => commitClosed!())
    expect(loads).toEqual(['/wt', '/wt', '/wt', '/wt'])
    // Another worktree on screen: its own reads, the first's listeners gone.
    await act(async () => root.render(<Probe worktree="/wt2" d={d} />))
    expect(unlistened).toBe(1)
    expect(watched).toEqual(['/wt', '/wt2'])
    expect(loads.at(-1)).toBe('/wt2')
    await act(async () => root.unmount())
    expect(watched.at(-1)).toBeNull()
    expect(commitClosed).toBeNull()
    loads.length = 0
    window.dispatchEvent(new Event('focus'))
    expect(loads).toEqual([])
  })

  it('reads on a clock when the tree cannot be watched, and stops with the panel', async () => {
    vi.useFakeTimers()
    watchFails = true
    const d = deps()
    await act(async () => root.render(<Probe worktree="/wt" d={d} />))
    expect(loads).toEqual(['/wt'])
    await act(async () => void vi.advanceTimersByTime(3_000))
    expect(loads).toHaveLength(4)
    await act(async () => root.unmount())
    await act(async () => void vi.advanceTimersByTime(3_000))
    expect(loads).toHaveLength(4)
  })

  it('does nothing with no worktree', async () => {
    const d = deps()
    await act(async () => root.render(<Probe worktree={null} d={d} />))
    expect(loads).toEqual([])
    expect(watched).toEqual([])
    await act(async () => root.unmount())
    expect(watched).toEqual([null])
  })
})

describe('pickInDiff', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })
  const pane = (id: number, files: string[], current?: string) => {
    const el = document.body.appendChild(document.createElement('div'))
    el.className = 'pane'
    el.dataset.pane = String(id)
    const clicks: string[] = []
    for (const f of files) {
      const b = el.appendChild(document.createElement('button'))
      b.dataset.file = f
      if (f === current) b.setAttribute('aria-current', 'true')
      b.addEventListener('click', () => clicks.push(f))
    }
    return clicks
  }

  it('clicks the file in that pane once it is listed', async () => {
    const other = pane(3, ['src/a "b".ts'])
    const stop = pickInDiff(7, 'src/a "b".ts', 1_000)
    await new Promise((r) => setTimeout(r, 60))
    const clicks = pane(7, ['x.ts', 'src/a "b".ts'])
    await new Promise((r) => setTimeout(r, 120))
    expect(clicks).toEqual(['src/a "b".ts'])
    expect(other).toEqual([])
    stop()
  })

  it('leaves the file shown already alone, and gives up in time', async () => {
    const clicks = pane(7, ['a.ts'], 'a.ts')
    pickInDiff(7, 'a.ts')
    expect(clicks).toEqual([])
    pickInDiff(7, 'missing.ts', 100)
    await new Promise((r) => setTimeout(r, 150))
    const later = pane(7, ['missing.ts'])
    await new Promise((r) => setTimeout(r, 120))
    expect(later).toEqual([])
  })
})

describe('pickRightbarTab', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })
  const sidebar = (selected: string) => {
    const el = document.body.appendChild(document.createElement('div'))
    el.dataset.rightSidebar = ''
    const clicks: string[] = []
    for (const label of ['Memory', 'Source Control']) {
      const b = el.appendChild(document.createElement('button'))
      b.setAttribute('role', 'tab')
      b.setAttribute('aria-label', label)
      b.setAttribute('aria-selected', String(label === selected))
      b.addEventListener('click', () => clicks.push(label))
    }
    return clicks
  }

  it('clicks the tab once the sidebar draws it, and leaves a shown tab alone', async () => {
    pickRightbarTab('Source Control', 500)
    const clicks = sidebar('Memory')
    await new Promise((r) => setTimeout(r, 80))
    expect(clicks).toEqual(['Source Control'])
    document.body.innerHTML = ''
    const again = sidebar('Source Control')
    pickRightbarTab('Source Control')
    expect(again).toEqual([])
  })
})
