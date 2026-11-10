// What mnemo learned, on the learned store. The install review's commands are answered here;
// every name is made up.

const t = vi.hoisted(() => ({
  calls: [] as [string, Record<string, unknown> | undefined][],
  /** What each step prints, in turn. */
  answers: {} as Record<string, string[]>,
  on: {} as Record<string, ((e: { payload: unknown }) => void)[]>,
  fleet: {
    repos: [
      { root: '/Users/you/work/lumen-web', name: 'lumen-web', worktrees: [] },
      { root: '/Users/you/work/atlas-api', name: 'atlas-api', worktrees: [] },
    ],
  },
}))

const page = (key: string, type: string, name: string) => ({ key, type, name, description: `about ${name}`, excerpt: `${name}, in full.`, staged_at: '2026-11-09T10:00:00', expires_at: '2026-11-23T10:00:00' })
const PAGES = [page('project/lumen-web__orders-poll', 'project', 'Orders poll'), page('feedback/lumen-web__confirm-bulk-cancel', 'feedback', 'Confirm a bulk cancel'), page('feedback/lumen-web__small-prs', 'feedback', 'Small pull requests')]
const EMPTY = JSON.stringify({ project: 'lumen-web', origin: 'backfill', pages: [] })
const LISTING = JSON.stringify({ project: 'lumen-web', origin: 'backfill', pages: PAGES })
const DRY = JSON.stringify({ project: 'lumen-web', sessions: 12, calls_estimate: 5, api_price_estimate_usd: null })

vi.mock('@tauri-apps/api/core', () => ({
  Channel: class {},
  invoke: async (cmd: string, args?: Record<string, unknown>) => {
    t.calls.push([cmd, args])
    if (cmd === 'install_review_project') {
      const cwd = args!.cwd as string
      return { project: cwd.split('/').pop(), root: cwd }
    }
    if (cmd === 'install_review_step') {
      const step = args!.step as string
      if (step === 'promote') return { stdout: JSON.stringify({ promoted: args!.keys, failed: [] }), stderr: '', code: 0 }
      if (step === 'drop') return { stdout: JSON.stringify({ dropped: args!.keys, failed: [] }), stderr: '', code: 0 }
      const stdout = t.answers[step]?.shift()
      return stdout === undefined ? { stdout: '', stderr: 'no answer', code: 1 } : { stdout, stderr: '', code: 0 }
    }
    if (cmd === 'install_review_run') return `install-review:${args!.project}`
    if (cmd === 'home_snapshot') return { repos: [], clone_base: '', errors: [], protected: 0 }
    return null
  },
}))
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (name: string, h: (e: { payload: unknown }) => void) => {
    ;(t.on[name] ??= []).push(h)
    return () => (t.on[name] = t.on[name].filter((x) => x !== h))
  },
}))
vi.mock('../../fleet/store', () => ({ useFleet: <T,>(sel: (f: typeof t.fleet) => T): T => sel(t.fleet) }))

import { act } from 'react'
import { learned } from '../../learned/app-store'
import { go, routeStore } from '../../world/route'
import { memoryPanel } from '../memory/state'
import { button, click, draw, flush, texts } from '../memory/testing'
import { LearnedPanel } from './Learned'

const steps = (step: string) => t.calls.filter(([c, a]) => c === 'install_review_step' && a!.step === step).map(([, a]) => a!.keys as string[])
const emit = (name: string, payload: unknown) => act(async () => void t.on[name]?.forEach((h) => h({ payload })))
const decide = () => document.querySelector<HTMLButtonElement>('[data-decide]')!
const keep = (name: string) => document.querySelector<HTMLInputElement>(`[aria-label="keep ${name}"]`)!

let undraw: (() => Promise<void>) | null = null
const open = async () => {
  undraw = await draw(<LearnedPanel />)
  await flush()
}
beforeEach(() => {
  t.calls.length = 0
  t.answers = {}
  t.on = {}
  memoryPanel.setState({ tab: 'activity', repo: null, project: null })
  learned.setState({ target: null, phase: { kind: 'idle' }, pages: [], checked: {}, expanded: {}, openedAt: null })
  go({ panel: 'learned' })
})
afterEach(async () => {
  await undraw?.()
  undraw = null
  go({ panel: null })
})

describe('the review', () => {
  beforeEach(async () => {
    t.answers = { list: [LISTING] }
    await open()
  })

  test('lists every page kept, grouped by type in the review’s order', () => {
    expect(texts('.learned-group-head .mn-label')).toEqual(['Project facts', 'Your rules'])
    expect(texts('.learned-row .sp-name')).toEqual(['Orders poll', 'Confirm a bulk cancel', 'Small pull requests'])
    expect(texts('.learned-fate')).toEqual(['kept', 'kept', 'kept'])
    expect(decide().textContent).toBe('Keep all 3')
  })

  test('with everything kept, one press promotes them all and drops none', async () => {
    await click(decide())
    expect(steps('promote')).toEqual([PAGES.map((p) => p.key)])
    expect(steps('drop')).toEqual([])
    expect(texts('.learned-figure').map((s) => s.replace(/\s+/g, ' '))).toEqual(['3kept', '0dropped'])
  })

  test('an unchecked page is dropped, and a decision that drops is asked twice', async () => {
    await click(keep('Orders poll'))
    expect(texts('.learned-fate')).toEqual(['dropped', 'kept', 'kept'])
    expect(decide().textContent).toBe('Keep 2, drop 1')
    await click(decide())
    expect(steps('promote')).toEqual([])
    expect(steps('drop')).toEqual([])
    expect(decide().textContent).toBe('Drop 1 page for good? Press again')
    await click(decide())
    expect(steps('promote')).toEqual([[PAGES[1].key, PAGES[2].key]])
    expect(steps('drop')).toEqual([[PAGES[0].key]])
    expect(texts('.learned-figure').map((s) => s.replace(/\s+/g, ' '))).toEqual(['2kept', '1dropped'])
  })

  test('a group keeps none in one press, and all in the next', async () => {
    const rules = document.querySelector('[data-type="feedback"]')!
    await click(button('Keep none', rules))
    expect(texts('.learned-fate')).toEqual(['kept', 'dropped', 'dropped'])
    expect(decide().textContent).toBe('Keep 1, drop 2')
    await click(button('Keep all', rules))
    expect(decide().textContent).toBe('Keep all 3')
  })

  test('a page shows its excerpt when pressed', async () => {
    await click(document.querySelector('[data-key="project/lumen-web__orders-poll"] .learned-pick'))
    expect(document.querySelector('[data-key="project/lumen-web__orders-poll"] .sp-out')!.textContent).toBe('Orders poll, in full.')
  })

  test('Decide later decides nothing and says until when the pages stay', async () => {
    await click(button('Decide later'))
    expect(steps('promote')).toEqual([])
    expect(steps('drop')).toEqual([])
    expect(document.querySelector('.learned-lead')!.textContent).toContain('stay staged until 2026-11-23')
  })

  test('closed and opened again, a checklist on screen is not read again or reset', async () => {
    await click(keep('Orders poll'))
    await undraw!()
    undraw = null
    t.calls.length = 0
    await open()
    expect(steps('list')).toEqual([])
    expect(decide().textContent).toBe('Keep 2, drop 1')
  })
})

describe('before anything is read', () => {
  beforeEach(async () => {
    t.answers = { list: [EMPTY], 'dry-run': [DRY] }
    await open()
  })

  test('the panel says how many sessions it would read and what it would cost, and reads nothing', () => {
    expect(texts('.learned-figure').map((s) => s.replace(/\s+/g, ' '))).toEqual(['12sessions to read', '≈5model calls on your plan'])
    expect(t.calls.some(([c]) => c === 'install_review_run')).toBe(false)
  })

  test('Read my history starts the run, and its lines move the two bars', async () => {
    await click(button('Read my history'))
    expect(t.calls.filter(([c]) => c === 'install_review_run').map(([, a]) => a)).toEqual([{ project: 'lumen-web', root: '/Users/you/work/lumen-web' }])
    const bar = (label: string) => document.querySelector(`[role=progressbar][aria-label="${label}"]`)!.getAttribute('aria-valuenow')
    expect([bar('reading sessions'), bar('learning from them')]).toEqual(['0', '0'])
    const line = (o: object) => emit('job-line', { id: 'install-review:lumen-web', stream: 'out', line: JSON.stringify(o) })
    await line({ event: 'harvest', done: 6, of: 12 })
    await line({ event: 'extract', done: 1, of: 5 })
    expect([bar('reading sessions'), bar('learning from them')]).toEqual(['50', '20'])
    // Another job's lines are not this run's.
    await emit('job-line', { id: 'install-review:atlas-api', stream: 'out', line: JSON.stringify({ event: 'harvest', done: 12, of: 12 }) })
    expect(bar('reading sessions')).toBe('50')
  })

  test('the run ending shows the pages it staged', async () => {
    await click(button('Read my history'))
    t.answers.list = [LISTING]
    await emit('job-exit', { id: 'install-review:lumen-web', code: 0 })
    await flush()
    expect(texts('.learned-row .sp-name')).toHaveLength(3)
  })

  test('Not now reads nothing and records the answer', async () => {
    await click(button('Not now'))
    expect(t.calls.some(([c]) => c === 'install_review_run')).toBe(false)
    expect(t.calls.filter(([c]) => c === 'install_review_record').map(([, a]) => a)).toEqual([{ project: 'lumen-web', decision: 'not-now' }])
  })
})

test('another repo is one press, and the review is that repo’s', async () => {
  t.answers = { list: [EMPTY, EMPTY], 'dry-run': [DRY, JSON.stringify({ project: 'atlas-api', sessions: 0, calls_estimate: 0 })] }
  await open()
  await click(button('atlas-api'))
  expect(t.calls.filter(([c]) => c === 'install_review_project').map(([, a]) => a!.cwd)).toEqual(['/Users/you/work/lumen-web', '/Users/you/work/atlas-api'])
  expect(document.querySelector('.learned-lead')!.textContent).toContain('Nothing to review in atlas-api')
})

test('a listing mnemo could not print is said, with a way to try again', async () => {
  t.answers = { list: [] }
  await open()
  expect(document.querySelector('[role=alert]')!.textContent).toContain('no answer')
  t.answers = { list: [LISTING] }
  await click(button('Try again'))
  expect(texts('.learned-row .sp-name')).toHaveLength(3)
})

test('Memory’s inbox opens the Memory panel on its inbox', async () => {
  t.answers = { list: [LISTING] }
  await open()
  await click(button('Memory’s inbox') ?? button("Memory's inbox"))
  expect(routeStore.getState().route.panel).toBe('memory')
  expect(memoryPanel.getState().tab).toBe('inbox')
})
