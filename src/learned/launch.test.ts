import dryRun from './fixtures/dry-run.json?raw'
import dryRunNone from './fixtures/dry-run-none.json?raw'
import type { Answer, ReviewProject } from './client'
import { watchForReview, type WatchDeps } from './launch'
import type { DryRun } from './types'

const flush = () => new Promise((r) => setTimeout(r, 0))

function harness(o: { decided?: Record<string, Answer>; dry?: string; ready?: Promise<unknown> } = {}) {
  const h = {
    cwd: undefined as string | undefined,
    listeners: [] as (() => void)[],
    shown: [] as [ReviewProject, DryRun][],
    calls: [] as string[],
  }
  const deps: WatchDeps = {
    client: {
      project: async (cwd) => {
        h.calls.push(`project ${cwd}`)
        const m = /^\/r\/([^/]+)/.exec(cwd)
        return m ? { project: m[1].replace(/-wt-.*$/, ''), root: `/r/${m[1].replace(/-wt-.*$/, '')}` } : null
      },
      decided: async (p) => {
        h.calls.push(`decided ${p}`)
        return o.decided?.[p] ?? null
      },
      step: async (step, t) => {
        h.calls.push(`${step} ${t.project}`)
        return { stdout: o.dry ?? dryRun, stderr: '', code: 0 }
      },
    },
    ready: o.ready ?? Promise.resolve(),
    cwd: () => h.cwd,
    subscribe: (fn) => {
      h.listeners.push(fn)
      return () => (h.listeners = h.listeners.filter((l) => l !== fn))
    },
    show: (t, d) => void h.shown.push([t, d]),
  }
  const move = async (cwd: string | undefined) => {
    h.cwd = cwd
    h.listeners.forEach((l) => l())
    await flush()
  }
  return { h, deps, move }
}

test('a repo with no decision and sessions to read gets the consent, once per run', async () => {
  const { h, deps, move } = harness()
  h.cwd = '/r/clubinho'
  watchForReview(deps)
  await flush()
  expect(h.shown).toEqual([[{ project: 'clubinho', root: '/r/clubinho' }, { project: 'clubinho', sessions: 44, callsEstimate: 19, priceUsd: 1.2 }]])
  expect(h.calls).toEqual(['project /r/clubinho', 'decided clubinho', 'dry-run clubinho'])
  // A worktree or a subfolder of the same project asks nothing more.
  await move('/r/clubinho-wt-3')
  await move('/r/clubinho/src')
  await move('/r/clubinho')
  expect(h.shown).toHaveLength(1)
  expect(h.calls.filter((c) => c.startsWith('decided'))).toEqual(['decided clubinho'])
})

test('nothing is asked before setup is done', async () => {
  let done = () => {}
  const { h, deps } = harness({ ready: new Promise<void>((r) => (done = r)) })
  h.cwd = '/r/clubinho'
  watchForReview(deps)
  await flush()
  expect(h.calls).toEqual([])
  done()
  await flush()
  expect(h.shown).toHaveLength(1)
})

test('a recorded decision, or no session to read, asks nothing', async () => {
  const decided = harness({ decided: { clubinho: 'later' } })
  decided.h.cwd = '/r/clubinho'
  watchForReview(decided.deps)
  await flush()
  expect(decided.h.shown).toEqual([])
  expect(decided.h.calls).toEqual(['project /r/clubinho', 'decided clubinho'])

  const none = harness({ dry: dryRunNone })
  none.h.cwd = '/r/clubinho'
  watchForReview(none.deps)
  await flush()
  expect(none.h.shown).toEqual([])
})

test('opening another repo later checks that one; outside a repo nothing runs', async () => {
  const { h, deps, move } = harness()
  watchForReview(deps)
  await flush()
  await move('/tmp/scratch')
  expect(h.calls).toEqual(['project /tmp/scratch'])
  await move('/r/clearframe')
  expect(h.shown.map(([t]) => t.project)).toEqual(['clearframe'])
})

test('a stopped watch asks nothing more', async () => {
  const { h, deps, move } = harness()
  const stop = watchForReview(deps)
  await flush()
  stop()
  await move('/r/clubinho')
  expect(h.calls).toEqual([])
})
