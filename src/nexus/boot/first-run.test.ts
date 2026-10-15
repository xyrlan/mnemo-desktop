import dryRun from '../../learned/fixtures/dry-run.json?raw'
import type { ReviewProject } from '../../learned/client'
import type { ToolName, ToolStatus } from '../../setup/tools'
import { firstRun, type FirstRunDeps } from './first-run'

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0))
}
const tool = (name: ToolName, path: string | null): ToolStatus => ({ name, path, version: path && `${name} 1.0`, managed: false })
const MISSING = [tool('git', '/usr/bin/git'), tool('gh', null), tool('claude', null), tool('mnemo', null)]
const FOUND = [tool('git', '/usr/bin/git'), tool('gh', null), tool('claude', '/bin/claude'), tool('mnemo', '/bin/mnemo')]

/** A launch: what `tools_status` answers, the repos the app knows, the review's store and the
 *  window over the ship, all fake. */
function harness(o: { tools?: ToolStatus[] | null; cwds?: string[]; decided?: string[] } = {}) {
  const h = {
    rows: null as ToolStatus[] | null,
    toolListeners: new Set<() => void>(),
    window: null as string | null,
    windowListeners: new Set<() => void>(),
    phase: 'idle' as 'idle' | 'consent' | 'running',
    opened: [] as string[],
    asked: [] as string[],
  }
  const setRows = (rows: ToolStatus[] | null) => {
    h.rows = rows
    h.toolListeners.forEach((l) => l())
  }
  const setWindow = (id: string | null) => {
    h.window = id
    h.windowListeners.forEach((l) => l())
  }
  const deps: FirstRunDeps = {
    checkTools: async () => {
      const rows = o.tools === undefined ? FOUND : o.tools
      if (rows) setRows(rows)
      return rows
    },
    toolRows: () => h.rows,
    subscribeTools: (fn) => {
      h.toolListeners.add(fn)
      return () => h.toolListeners.delete(fn)
    },
    review: {
      client: {
        project: async (cwd) => ({ project: cwd.slice(3), root: cwd }),
        decided: async (p) => (o.decided?.includes(p) ? 'kept' : null),
        step: async () => ({ stdout: dryRun, stderr: '', code: 0 }),
      },
      cwds: () => o.cwds ?? ['/r/repo-a'],
      subscribe: () => () => {},
    },
    ask: (target: ReviewProject) => {
      if (h.phase !== 'idle') return false
      h.phase = 'consent'
      h.asked.push(target.project)
      return true
    },
    stillAsking: () => h.phase === 'consent',
    openWindowId: () => h.window,
    subscribeWindow: (fn) => {
      h.windowListeners.add(fn)
      return () => h.windowListeners.delete(fn)
    },
    open: (id) => {
      h.opened.push(id)
      setWindow(id)
    },
  }
  return { h, deps, setRows, setWindow }
}

test('claude and mnemo found: Setup stays shut, and the first repo with history to read gets What mnemo learned', async () => {
  const { h, deps } = harness({ cwds: ['/r/repo-a', '/r/repo-b'], decided: ['repo-a'] })
  firstRun(deps)
  await flush()
  expect(h.opened).toEqual(['learned'])
  expect(h.asked).toEqual(['repo-b'])
})

test('claude or mnemo missing: Setup opens, and What mnemo learned only once both are found and Setup is closed', async () => {
  const { h, deps, setRows, setWindow } = harness({ tools: MISSING })
  firstRun(deps)
  await flush()
  expect(h.opened).toEqual(['setup'])
  expect(h.asked).toEqual([])

  // Installed from the Setup window: the review asks, but never over the window being read.
  setRows(FOUND)
  await flush()
  expect(h.asked).toEqual(['repo-a'])
  expect(h.opened).toEqual(['setup'])

  setWindow(null)
  expect(h.opened).toEqual(['setup', 'learned'])
})

test('a window the user opened is not jumped either; an answer given meanwhile opens nothing', async () => {
  const waits = harness()
  waits.h.window = 'missions'
  firstRun(waits.deps)
  await flush()
  expect(waits.h.opened).toEqual([])
  waits.setWindow('projects')
  expect(waits.h.opened).toEqual([])
  waits.setWindow(null)
  expect(waits.h.opened).toEqual(['learned'])

  // Opened by hand from SYSTEMS and answered there before the other window closed.
  const answered = harness()
  answered.h.window = 'missions'
  firstRun(answered.deps)
  await flush()
  answered.h.phase = 'running'
  answered.setWindow(null)
  expect(answered.h.opened).toEqual([])
})

test('a review already on screen is not replaced, and nothing opens for it', async () => {
  const { h, deps } = harness()
  h.phase = 'running'
  firstRun(deps)
  await flush()
  expect(h.asked).toEqual([])
  expect(h.opened).toEqual([])
})

test('a failed tools check opens nothing', async () => {
  const { h, deps } = harness({ tools: null })
  firstRun(deps)
  await flush()
  expect(h.opened).toEqual([])
})

test('stopped, nothing opens: not Setup, not the review waiting on a window', async () => {
  const early = harness({ tools: MISSING })
  firstRun(early.deps)()
  await flush()
  expect(early.h.opened).toEqual([])

  const late = harness()
  late.h.window = 'missions'
  const stop = firstRun(late.deps)
  await flush()
  stop()
  late.setWindow(null)
  expect(late.h.opened).toEqual([])
  expect(late.h.windowListeners.size).toBe(0)
})
