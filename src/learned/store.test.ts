import dryRun from './fixtures/dry-run.json?raw'
import dryRunNone from './fixtures/dry-run-none.json?raw'
import listing from './fixtures/listing.json?raw'
import progress from './fixtures/progress.jsonl?raw'
import promoteFailed from './fixtures/promote-failed.json?raw'
import drop from './fixtures/drop.json?raw'
import type { RunResult } from '../vault/types'
import type { JobHandlers, LearnedClient, ReviewProject, Step } from './client'
import { createLearnedStore, type Phase } from './store'
import { parseDryRun } from './types'

const T: ReviewProject = { project: 'clubinho', root: '/r/clubinho' }
const ok = (stdout: string): RunResult => ({ stdout, stderr: '', code: 0 })
const EMPTY = '{"project": "clubinho", "origin": "backfill", "pages": [], "counts": {}}'

/** A client over the fixtures. `answers[step]` is what each call prints, in turn. */
function fake(answers: Partial<Record<Step, RunResult[]>> = {}) {
  const f = {
    steps: [] as { step: Step; keys: string[] }[],
    rows: [] as Record<string, unknown>[],
    records: [] as [string, string][],
    handlers: [] as JobHandlers[],
    runs: 0,
    runError: null as string | null,
    client: null as unknown as LearnedClient,
  }
  f.client = {
    project: async (cwd) => (cwd.startsWith('/r/clubinho') ? T : null),
    step: async (step, _t, keys = []) => {
      f.steps.push({ step, keys })
      return answers[step]?.shift() ?? { stdout: '', stderr: `no answer for ${step}`, code: 1 }
    },
    run: async () => {
      f.runs++
      if (f.runError) throw new Error(f.runError)
    },
    onJob: async (h) => {
      f.handlers.push(h)
      return () => (f.handlers = f.handlers.filter((x) => x !== h))
    },
    decided: async () => null,
    record: async (p, a) => void f.records.push([p, a]),
    log: (row) => void f.rows.push(row),
  }
  return f
}

const flush = () => new Promise((r) => setTimeout(r, 0))
const kind = (p: Phase) => p.kind

describe('consent', () => {
  test('with nothing staged and sessions to read, it asks and runs nothing', async () => {
    const f = fake({ list: [ok(EMPTY)], 'dry-run': [ok(dryRun)] })
    const s = createLearnedStore(f.client)
    await s.getState().open(T)
    expect(s.getState().phase).toEqual({ kind: 'consent', dry: { project: 'clubinho', sessions: 44, callsEstimate: 19, priceUsd: 1.2 } })
    expect(f.steps.map((x) => x.step)).toEqual(['list', 'dry-run'])
    expect(f.runs).toBe(0)
  })

  test('[Not now] runs nothing and records the answer', async () => {
    const f = fake()
    const s = createLearnedStore(f.client)
    s.getState().ask(T, parseDryRun(dryRun)!)
    await s.getState().notNow()
    expect(kind(s.getState().phase)).toBe('declined')
    expect(f.runs).toBe(0)
    expect(f.records).toEqual([['clubinho', 'not-now']])
    expect(f.rows).toEqual([])
  })

  test('with no session to read and nothing staged, there is nothing to review', async () => {
    const f = fake({ list: [ok(EMPTY)], 'dry-run': [ok(dryRunNone)] })
    const s = createLearnedStore(f.client)
    await s.getState().open(T)
    expect(kind(s.getState().phase)).toBe('nothing')
  })

  test('pages already staged go straight to the review, without a dry run', async () => {
    const f = fake({ list: [ok(listing)] })
    const s = createLearnedStore(f.client)
    await s.getState().open(T)
    expect(kind(s.getState().phase)).toBe('review')
    expect(f.steps.map((x) => x.step)).toEqual(['list'])
  })

  test('a CLI that does not answer JSON shows what it said', async () => {
    const f = fake({ list: [{ stdout: '', stderr: 'mnemo inbox: unrecognized arguments: --origin', code: 2 }] })
    const s = createLearnedStore(f.client)
    await s.getState().open(T)
    expect(s.getState().phase).toEqual({ kind: 'error', message: expect.stringContaining('unrecognized arguments: --origin') })
  })

  test('outside a repo there is no project to review', async () => {
    const s = createLearnedStore(fake().client)
    await s.getState().openCwd('/tmp')
    expect(kind(s.getState().phase)).toBe('no-repo')
    await s.getState().openCwd(undefined)
    expect(kind(s.getState().phase)).toBe('no-repo')
  })
})

describe('running', () => {
  test('progress lines move the bars, and the exit opens the review', async () => {
    const f = fake({ list: [ok(listing)] })
    const s = createLearnedStore(f.client)
    s.getState().ask(T, parseDryRun(dryRun)!)
    const done = s.getState().consent()
    await flush()
    expect(f.runs).toBe(1)
    expect(s.getState().phase).toEqual({ kind: 'running', harvest: null, extract: null, err: [] })
    const [h] = f.handlers
    const lines = progress.split('\n').filter(Boolean)
    h.line('install-review:clubinho', 'out', lines[1])
    expect(s.getState().phase).toMatchObject({ harvest: { done: 3, of: 44 }, extract: null })
    // Another job's lines are not this run's.
    h.line('merge:7', 'out', '{"event": "harvest", "done": 40, "of": 44}')
    h.line('install-review:clubinho', 'err', 'session 12: timed out')
    h.line('install-review:clubinho', 'out', lines[3])
    expect(s.getState().phase).toMatchObject({ harvest: { done: 3, of: 44 }, extract: { done: 1, of: 8 }, err: ['session 12: timed out'] })
    h.line('install-review:clubinho', 'out', lines.at(-1)!)
    h.exit('install-review:clubinho', 0)
    await done
    expect(kind(s.getState().phase)).toBe('review')
    expect(f.handlers).toEqual([])
  })

  test('exit 2 is a failure that shows what the run printed on stderr', async () => {
    const f = fake()
    const s = createLearnedStore(f.client)
    s.getState().ask(T, parseDryRun(dryRun)!)
    const done = s.getState().consent()
    await flush()
    f.handlers[0].line('install-review:clubinho', 'err', 'no Claude Code login')
    f.handlers[0].exit('install-review:clubinho', 2)
    await done
    expect(s.getState().phase).toEqual({ kind: 'error', message: 'mnemo backfill exited 2:\nno Claude Code login' })
  })

  test('a sweep that finished opens the review even when it exits 1, and one that did not is a failure', async () => {
    const run = async (lines: string[], code: number) => {
      const f = fake({ list: [ok(listing)] })
      const s = createLearnedStore(f.client)
      s.getState().ask(T, parseDryRun(dryRun)!)
      const done = s.getState().consent()
      await flush()
      for (const l of lines) f.handlers[0].line('install-review:clubinho', 'out', l)
      f.handlers[0].exit('install-review:clubinho', code)
      await done
      return s.getState().phase
    }
    expect(kind(await run(['{"event": "done", "staged": 5, "live": 0, "failed": 2}'], 1))).toBe('review')
    expect(await run(['{"event": "harvest", "done": 3, "of": 44}'], 1)).toEqual({ kind: 'error', message: 'mnemo backfill exited 1' })
  })

  test('a run that cannot start says why', async () => {
    const f = fake()
    f.runError = 'job install-review:clubinho is already running'
    const s = createLearnedStore(f.client)
    s.getState().ask(T, parseDryRun(dryRun)!)
    await s.getState().consent()
    expect(s.getState().phase).toEqual({ kind: 'error', message: 'mnemo backfill: job install-review:clubinho is already running' })
  })

  test('while it runs, opening the review again does not restart or replace it', async () => {
    const f = fake()
    const s = createLearnedStore(f.client)
    s.getState().ask(T, parseDryRun(dryRun)!)
    void s.getState().consent()
    await flush()
    await s.getState().open({ project: 'other', root: '/r/other' })
    s.getState().ask({ project: 'other', root: '/r/other' }, parseDryRun(dryRun)!)
    expect(s.getState()).toMatchObject({ target: T, phase: { kind: 'running' } })
    expect(f.steps).toEqual([])
  })
})

describe('review', () => {
  async function reviewing(answers: Partial<Record<Step, RunResult[]>>, clock: { t: number }) {
    const f = fake({ list: [ok(listing)], ...answers })
    const s = createLearnedStore(f.client, () => clock.t)
    await s.getState().open(T)
    return { f, s }
  }

  test('everything starts checked; a group toggles all or none; rows expand', async () => {
    const { s } = await reviewing({}, { t: 0 })
    expect(Object.values(s.getState().checked)).toEqual([true, true, true, true, true])
    s.getState().setType('project', false)
    expect(s.getState().checked).toMatchObject({ 'project/clubinho__cron-annual-bloqueado-183': false, 'project/clubinho__staging-db-is-shared': false, 'feedback/clubinho__answer-in-portuguese': true })
    s.getState().setType('project', true)
    s.getState().toggle('feedback/clubinho__answer-in-portuguese')
    expect(s.getState().checked['feedback/clubinho__answer-in-portuguese']).toBe(false)
    s.getState().expand('reference/clubinho__asaas-sandbox')
    expect(s.getState().expanded).toEqual({ 'reference/clubinho__asaas-sandbox': true })
  })

  test('[Keep selected] promotes the checked, drops the unchecked, and shows the failed key', async () => {
    const clock = { t: 1_000 }
    const { f, s } = await reviewing({ promote: [ok(promoteFailed)], drop: [ok(drop)] }, clock)
    s.getState().toggle('project/clubinho__staging-db-is-shared')
    clock.t = 95_400
    await s.getState().keep()
    expect(f.steps.slice(1)).toEqual([
      {
        step: 'promote',
        keys: ['project/clubinho__cron-annual-bloqueado-183', 'feedback/clubinho__answer-in-portuguese', 'reference/clubinho__asaas-sandbox', 'user/clubinho__runs-on-a-mac'],
      },
      { step: 'drop', keys: ['project/clubinho__staging-db-is-shared'] },
    ])
    expect(s.getState().phase).toEqual({
      kind: 'done',
      skipped: false,
      kept: ['project/clubinho__cron-annual-bloqueado-183', 'feedback/clubinho__answer-in-portuguese', 'reference/clubinho__asaas-sandbox'],
      dropped: ['project/clubinho__staging-db-is-shared'],
      failed: [{ key: 'user/clubinho__runs-on-a-mac', error: 'not staged' }],
      expiresAt: '2026-10-08T10:12:07',
    })
    expect(f.rows).toEqual([{ event: 'install-review', project: 'clubinho', shown: 5, kept: 3, dropped: 1, failed: 1, seconds: 94, skipped: false }])
    expect(f.records).toEqual([['clubinho', 'kept']])
  })

  test('the measurement row holds no page text', async () => {
    const { f, s } = await reviewing({ promote: [ok(promoteFailed)] }, { t: 0 })
    await s.getState().keep()
    const text = JSON.stringify(f.rows)
    for (const p of s.getState().pages) for (const t of [p.key, p.name, p.description, p.excerpt]) expect(text).not.toContain(t)
  })

  test('with everything checked nothing is dropped, and a failed call fails each of its keys', async () => {
    const { f, s } = await reviewing({ promote: [{ stdout: '', stderr: 'mnemo: vault is locked', code: 2 }] }, { t: 0 })
    await s.getState().keep()
    expect(f.steps.map((x) => x.step)).toEqual(['list', 'promote'])
    const phase = s.getState().phase
    expect(phase.kind === 'done' && phase.failed).toHaveLength(5)
    expect(phase.kind === 'done' && phase.failed[0]).toEqual({ key: 'project/clubinho__cron-annual-bloqueado-183', error: 'mnemo: vault is locked' })
  })

  test('[Decide later] decides nothing and says when the pages expire', async () => {
    const clock = { t: 0 }
    const { f, s } = await reviewing({}, clock)
    s.getState().toggle('user/clubinho__runs-on-a-mac')
    clock.t = 12_000
    await s.getState().later()
    expect(f.steps.map((x) => x.step)).toEqual(['list'])
    expect(s.getState().phase).toEqual({ kind: 'done', skipped: true, kept: [], dropped: [], failed: [], expiresAt: '2026-10-08T10:12:03' })
    expect(f.rows).toEqual([{ event: 'install-review', project: 'clubinho', shown: 5, kept: 0, dropped: 0, failed: 0, seconds: 12, skipped: true }])
    expect(f.records).toEqual([['clubinho', 'later']])
  })

  test('a decision is taken once: a second click does nothing', async () => {
    const { f, s } = await reviewing({ promote: [ok(promoteFailed)] }, { t: 0 })
    await Promise.all([s.getState().keep(), s.getState().keep(), s.getState().later()])
    expect(f.steps.map((x) => x.step)).toEqual(['list', 'promote'])
    expect(f.rows).toHaveLength(1)
  })
})
