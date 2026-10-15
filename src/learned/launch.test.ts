import dryRun from './fixtures/dry-run.json?raw'
import dryRunNone from './fixtures/dry-run-none.json?raw'
import type { Answer, ReviewProject } from './client'
import { watchForReview, type WatchDeps } from './launch'
import type { DryRun } from './types'

const flush = () => new Promise((r) => setTimeout(r, 0))

function harness(o: { decided?: Record<string, Answer>; dry?: string; ready?: Promise<unknown> } = {}) {
  const h = {
    cwds: [] as string[],
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
    cwds: () => h.cwds,
    subscribe: (fn) => {
      h.listeners.push(fn)
      return () => (h.listeners = h.listeners.filter((l) => l !== fn))
    },
    show: (t, d) => void h.shown.push([t, d]),
  }
  /** The app learns of another repo. */
  const learn = async (cwd: string) => {
    h.cwds = [...h.cwds, cwd]
    h.listeners.forEach((l) => l())
    await flush()
  }
  return { h, deps, learn }
}

test('a repo with no decision and sessions to read gets the consent, once per run', async () => {
  const { h, deps, learn } = harness()
  h.cwds = ['/r/repo-a']
  watchForReview(deps)
  await flush()
  expect(h.shown).toEqual([[{ project: 'repo-a', root: '/r/repo-a' }, { project: 'repo-a', sessions: 44, callsEstimate: 19, priceUsd: 1.2 }]])
  expect(h.calls).toEqual(['project /r/repo-a', 'decided repo-a', 'dry-run repo-a'])
  // Asked once, nothing more is looked at in this run.
  await learn('/r/repo-b')
  expect(h.shown).toHaveLength(1)
  expect(h.calls.filter((c) => c.startsWith('decided'))).toEqual(['decided repo-a'])
})

test('the repos are looked at in order, and the first with sessions to read is the one asked', async () => {
  const { h, deps } = harness({ decided: { 'repo-a': 'kept' } })
  h.cwds = ['/r/repo-a', '/r/repo-a-wt-3', '/tmp/scratch', '/r/repo-b', '/r/repo-c']
  watchForReview(deps)
  for (let i = 0; i < 10; i++) await flush()
  expect(h.shown.map(([t]) => t.project)).toEqual(['repo-b'])
  // A worktree of a project already looked at is resolved, never decided twice; repo-c never runs.
  expect(h.calls).toEqual(['project /r/repo-a', 'decided repo-a', 'project /r/repo-a-wt-3', 'project /tmp/scratch', 'project /r/repo-b', 'decided repo-b', 'dry-run repo-b'])
})

test('nothing is asked before setup is done', async () => {
  let done = () => {}
  const { h, deps } = harness({ ready: new Promise<void>((r) => (done = r)) })
  h.cwds = ['/r/repo-a']
  watchForReview(deps)
  await flush()
  expect(h.calls).toEqual([])
  done()
  await flush()
  expect(h.shown).toHaveLength(1)
})

test('a recorded decision, or no session to read, asks nothing', async () => {
  const decided = harness({ decided: { 'repo-a': 'later' } })
  decided.h.cwds = ['/r/repo-a']
  watchForReview(decided.deps)
  await flush()
  expect(decided.h.shown).toEqual([])
  expect(decided.h.calls).toEqual(['project /r/repo-a', 'decided repo-a'])

  const none = harness({ dry: dryRunNone })
  none.h.cwds = ['/r/repo-a']
  watchForReview(none.deps)
  await flush()
  expect(none.h.shown).toEqual([])
})

test('a repo the app learns of later is looked at then; outside a repo nothing runs', async () => {
  const { h, deps, learn } = harness()
  watchForReview(deps)
  await flush()
  await learn('/tmp/scratch')
  expect(h.calls).toEqual(['project /tmp/scratch'])
  await learn('/r/repo-c')
  for (let i = 0; i < 5; i++) await flush()
  expect(h.shown.map(([t]) => t.project)).toEqual(['repo-c'])
  // Looked at once: the scratch folder is not resolved again.
  expect(h.calls.filter((c) => c === 'project /tmp/scratch')).toHaveLength(1)
})

test('a stopped watch asks nothing more', async () => {
  const { h, deps, learn } = harness()
  const stop = watchForReview(deps)
  await flush()
  stop()
  await learn('/r/repo-a')
  expect(h.calls).toEqual([])
})
