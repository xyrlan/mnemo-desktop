import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import dryRun from './fixtures/dry-run.json?raw'
import listing from './fixtures/listing.json?raw'
import progress from './fixtures/progress.jsonl?raw'
import promoteFailed from './fixtures/promote-failed.json?raw'
import drop from './fixtures/drop.json?raw'

const t = vi.hoisted(() => ({
  calls: [] as [string, Record<string, unknown> | undefined][],
  answers: {} as Record<string, string[]>,
  on: {} as Record<string, ((e: { payload: unknown }) => void)[]>,
}))
vi.mock('@tauri-apps/api/core', () => ({
  Channel: class {},
  invoke: async (cmd: string, args?: Record<string, unknown>) => {
    t.calls.push([cmd, args])
    if (cmd === 'install_review_step') {
      const stdout = t.answers[args!.step as string]?.shift()
      return stdout === undefined ? { stdout: '', stderr: 'no answer', code: 1 } : { stdout, stderr: '', code: 0 }
    }
    if (cmd === 'install_review_run') return 'install-review:clubinho'
    if (cmd === 'install_review_project') return (args!.cwd as string).startsWith('/r/clubinho') ? { project: 'clubinho', root: '/r/clubinho' } : null
    return null
  },
}))
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (name: string, h: (e: { payload: unknown }) => void) => {
    ;(t.on[name] ??= []).push(h)
    return () => (t.on[name] = t.on[name].filter((x) => x !== h))
  },
}))

const T = { project: 'clubinho', root: '/r/clubinho' }
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))
const click = (el: Element | null | undefined) => act(() => void (el as HTMLElement).click())
const button = (el: Element, text: string | RegExp) =>
  [...el.querySelectorAll('button')].find((b) => (typeof text === 'string' ? b.textContent === text : text.test(b.textContent ?? '')))
const emit = async (name: string, payload: unknown) => {
  await act(async () => (t.on[name] ?? []).forEach((h) => h({ payload })))
}
const line = (text: string) => emit('job-line', { id: 'install-review:clubinho', stream: 'out', line: text })
const called = (cmd: string) => t.calls.filter(([c]) => c === cmd).map(([, a]) => a)

let host: HTMLDivElement
let root: Root | null = null

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

beforeEach(async () => {
  t.calls = []
  t.answers = {}
  const { learned } = await import('./app-store')
  learned.setState({ target: null, phase: { kind: 'idle' }, pages: [], checked: {}, expanded: {}, openedAt: null })
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  host?.remove()
})

async function mount() {
  await import('./view')
  const { paneView } = await import('../panes/registry')
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(createElement(paneView('learned')!, { id: 1, props: {} })))
  await flush()
}

test('consent: the dry run\'s sessions and calls, and nothing runs before yes', async () => {
  const { learned } = await import('./app-store')
  const { parseDryRun } = await import('./types')
  learned.getState().ask(T, parseDryRun(dryRun)!)
  await mount()
  expect(host.textContent).toContain('mnemo can read your last 44 sessions in clubinho and learn from them. About 19 model calls on your Claude plan.')
  expect(button(host, 'Read my history')).toBeTruthy()
  expect(called('install_review_run')).toEqual([])
  await click(button(host, 'Not now'))
  await flush()
  expect(called('install_review_run')).toEqual([])
  expect(called('install_review_record')).toEqual([{ project: 'clubinho', decision: 'not-now' }])
  expect(host.textContent).toContain('Nothing was read.')
})

test('running: the bars follow the progress lines, and closing the screen does not stop the run', async () => {
  const { learned } = await import('./app-store')
  const { parseDryRun } = await import('./types')
  learned.getState().ask(T, parseDryRun(dryRun)!)
  t.answers.list = [listing]
  await mount()
  await click(button(host, 'Read my history'))
  await flush()
  expect(called('install_review_run')).toEqual([{ project: 'clubinho', root: '/r/clubinho' }])
  const lines = progress.split('\n').filter(Boolean)
  await line(lines[1])
  const bars = () => [...host.querySelectorAll('[role="progressbar"]')].map((b) => [b.getAttribute('aria-label'), b.getAttribute('aria-valuenow')])
  expect(bars()).toEqual([
    ['reading sessions', '7'],
    ['learning from them', '0'],
  ])
  expect(host.textContent).toContain('reading sessions 3 of 44')
  await line(lines[3])
  expect(host.textContent).toContain('learning from them 1 of 8')

  // Leave the screen: the pane goes, the run and the store's listener stay.
  act(() => root!.unmount())
  root = null
  await line(lines.at(-1)!)
  await emit('job-exit', { id: 'install-review:clubinho', code: 0 })
  await flush()
  expect(learned.getState().phase.kind).toBe('review')

  // Coming back shows the review the run ended in.
  await mount()
  expect(host.querySelectorAll('.ln-row')).toHaveLength(5)
})

test('review: groups with counts, keep all/none, an expandable excerpt, and a failed key after the decision', async () => {
  t.answers = { list: [listing], promote: [promoteFailed], drop: [drop] }
  const { learned } = await import('./app-store')
  await learned.getState().open(T)
  await mount()
  const groups = () => [...host.querySelectorAll('.ln-group-head')].map((g) => g.textContent)
  expect(groups()).toEqual(['Project facts2 of 2 keptkeep none', 'Your rules1 of 1 keptkeep none', 'Technical references1 of 1 keptkeep none', 'user1 of 1 keptkeep none'])
  expect([...host.querySelectorAll<HTMLInputElement>('.ln-row input')].every((i) => i.checked)).toBe(true)
  expect(host.textContent).toContain('undecided pages expire on 2026-10-08')

  const project = host.querySelector('[data-type="project"]')!
  await click(button(project, 'keep none'))
  expect(groups()[0]).toBe('Project facts0 of 2 keptkeep all')
  await click(button(project, 'keep all'))
  const staging = host.querySelector('[data-key="project/clubinho__staging-db-is-shared"]')!
  await act(() => void staging.querySelector<HTMLInputElement>('input')!.click())
  expect(groups()[0]).toBe('Project facts1 of 2 keptkeep all')

  expect(host.querySelector('.ln-excerpt')).toBeNull()
  await click(staging.querySelector('.ln-row-name'))
  expect(staging.querySelector('.ln-excerpt')?.textContent).toContain('A migration run against the wrong URL hits production.')

  await click(button(host, 'Keep selected (4)'))
  await flush()
  const steps = called('install_review_step').slice(1)
  expect(steps).toEqual([
    { step: 'promote', project: 'clubinho', root: '/r/clubinho', keys: ['project/clubinho__cron-annual-bloqueado-183', 'feedback/clubinho__answer-in-portuguese', 'reference/clubinho__asaas-sandbox', 'user/clubinho__runs-on-a-mac'] },
    { step: 'drop', project: 'clubinho', root: '/r/clubinho', keys: ['project/clubinho__staging-db-is-shared'] },
  ])
  expect(host.textContent).toContain('Kept 3, dropped 1.')
  expect(host.querySelector('[data-failed="user/clubinho__runs-on-a-mac"]')?.textContent).toBe('user/clubinho__runs-on-a-mac not staged')
  expect(host.textContent).toContain('1 page was not decided and stays staged until 2026-10-08')
  const [row] = called('usage_log') as { row: Record<string, unknown> }[]
  expect(row.row).toMatchObject({ event: 'install-review', project: 'clubinho', shown: 5, kept: 3, dropped: 1, failed: 1, skipped: false })
  expect(called('install_review_record')).toEqual([{ project: 'clubinho', decision: 'kept' }])
})

test('decide later: nothing decided, and the pages expire on the listing\'s date', async () => {
  t.answers = { list: [listing] }
  const { learned } = await import('./app-store')
  await learned.getState().open(T)
  await mount()
  await click(button(host, 'Decide later'))
  await flush()
  expect(called('install_review_step').map((a) => a!.step)).toEqual(['list'])
  expect(host.textContent).toContain('Nothing decided. The pages stay staged until 2026-10-08, then expire')
  const [row] = called('usage_log') as { row: Record<string, unknown> }[]
  expect(row.row).toMatchObject({ shown: 5, kept: 0, dropped: 0, skipped: true })
  expect(called('install_review_record')).toEqual([{ project: 'clubinho', decision: 'later' }])
})

test('the vault inbox opens the review of the repo it is in', async () => {
  t.answers = { list: [listing] }
  await import('./view')
  const { reviewWhatWasLearned } = await import('./open')
  const { store } = await import('../layout/app-store')
  const { learned } = await import('./app-store')
  reviewWhatWasLearned('/r/clubinho/src')
  await flush()
  const s = store.getState()
  expect(Object.values(s.panes).filter((p) => p.view === 'learned')).toHaveLength(1)
  expect(learned.getState()).toMatchObject({ target: T, phase: { kind: 'review' } })
  // A second open goes to the same pane.
  reviewWhatWasLearned('/r/clubinho')
  await flush()
  expect(Object.values(store.getState().panes).filter((p) => p.view === 'learned')).toHaveLength(1)
})
