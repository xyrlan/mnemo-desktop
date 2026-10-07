import { act } from 'react'
import { createRoot } from 'react-dom/client'
// What mnemo 1.7.0 prints. `vault.rs` parses the same files into the tiles given below
// (`tiles_of_mnemo_1_7_status_skip_every_line_they_do_not_know`).
import statusText from '../../src-tauri/fixtures/mnemo/status.txt?raw'
import emptyStatusText from '../../src-tauri/fixtures/mnemo/status-empty.txt?raw'
import doctorText from '../../src-tauri/fixtures/mnemo/doctor.txt?raw'
import type { Health, Page, RuleRow, RunResult, Tile } from './types'

const dir = '/v/shared/feedback'
const row = (slug: string, over: Partial<RuleRow> = {}): RuleRow => ({
  path: `${dir}/${slug}.md`,
  slug,
  name: slug,
  description: `about ${slug}`,
  type: 'feedback',
  agent: 'shared',
  confidence: 'verified',
  topics: ['testing'],
  fires: 3,
  last_fired: Date.now() - 2 * 86400_000,
  heat: 2.5,
  badges: [],
  reasons: [],
  ...over,
})
const ran = (stdout: string, code: number | null = 0, stderr = ''): RunResult => ({ stdout, stderr, code })
const tile = (key: string, label: string, value: string, detail: string, tone: Tile['tone'] = 'muted'): Tile => ({ key, label, value, detail, tone })
/** `parse_tiles` of status.txt. */
const TILES: Tile[] = [
  tile('briefings', 'briefings', '954', 'across 19 agents (5.9 MB)'),
  tile('breaker', 'circuit breaker', 'closed', 'ok', 'ok'),
  tile('reflex', 'reflex injected', '33.0%', '747 of 2266 prompts'),
  tile('recall', 'recall primacy@5', '47.6%', 'over 166 cases'),
]
const healthOf = (over: Partial<Health> = {}): Health => ({
  root: '/Users/me/mnemo',
  status: ran(statusText),
  tiles: TILES,
  label_only: [],
  dormant: [],
  pages: 2,
  never_fired: 0,
  inbox: 0,
  error: null,
  ...over,
})
/** `mnemo stale --json` as 1.7.0 prints it: `findings`, the path under `page`. */
const staleOut = JSON.stringify({
  project: 'app',
  ref: 'HEAD',
  pages_scanned: 2,
  stale_pages: 1,
  findings: [{ slug: 'app__target-dir', page: `${dir}/target-dir.md`, missing: [{ span: 'src/old.ts', path: 'src/old.ts', line: null, moved_to: null }] }],
})

/** What each command answers; a test replaces what it needs. */
type Answers = { rules: RuleRow[]; health(): Promise<Health>; doctor(): Promise<RunResult>; stale: RunResult }
const fresh = (): Answers => ({
  rules: [row('run-tests', { name: 'Run the tests' }), row('target-dir')],
  health: async () => healthOf(),
  doctor: async () => ran(doctorText),
  stale: ran(staleOut),
})
let answers = fresh()
const calls: string[] = []

vi.mock('@tauri-apps/api/core', () => ({
  Channel: class {},
  invoke: async (cmd: string, args?: Record<string, unknown>) => {
    calls.push(cmd)
    if (cmd === 'vault_rules') return answers.rules
    if (cmd === 'vault_health') return answers.health()
    if (cmd === 'vault_doctor') return answers.doctor()
    if (cmd === 'vault_run' && args!.action === 'stale') return answers.stale
    if (cmd === 'vault_run') return ran('ok')
    if (cmd === 'vault_page') {
      const r = answers.rules.find((x) => x.path === args!.path)!
      return { ...r, modified: null, body: 'body', runtime: null, frontmatter: [], error: null } satisfies Page
    }
    return undefined
  },
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))

const { HealthTable } = await import('./HealthTable')
const { vault } = await import('./app-store')
const initial = vault.getState()

beforeEach(() => {
  answers = fresh()
  calls.length = 0
  vault.setState(initial, true)
})

const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))
const click = (el: Element | null | undefined) => act(() => void (el as HTMLElement).click())
const byText = (root: HTMLElement, sel: string, text: string) => [...root.querySelectorAll(sel)].find((b) => b.textContent === text)
const tiles = (host: HTMLElement) => [...host.querySelectorAll('.vr-strip .vh-tile')].map((t) => t.textContent)
const names = (host: HTMLElement) => [...host.querySelectorAll('.vr-name-main')].map((e) => e.textContent)
const rawButton = (host: HTMLElement) => byText(host, 'button', 'status / doctor')
const rawBlock = (host: HTMLElement, title: string) => [...host.querySelectorAll('.vr-raw-block')].find((b) => b.querySelector('.vr-raw-title')?.textContent?.startsWith(title))
const errorLine = (host: HTMLElement) => host.querySelector('.vr > .vt-error-line')
const doctorCalls = () => calls.filter((c) => c === 'vault_doctor').length

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)))
  return { promise, resolve, reject }
}

async function mount() {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  Element.prototype.scrollIntoView ??= () => {}
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => root.render(<HealthTable cwd="/repo" current="app" />))
  await flush()
  return { host, unmount: () => act(async () => (root.unmount(), host.remove())) }
}

test('mnemo 1.7 status and doctor: tiles from the lines it knows, every line in the raw panel, stale reasons from findings', async () => {
  const { host, unmount } = await mount()
  expect(tiles(host)).toEqual(['954briefings', 'closedcircuit breaker', '33.0%reflex injected', '47.6%recall primacy@5', '1needs review', '0inbox'])
  expect(names(host)).toEqual(['Run the tests', 'target-dir'])
  expect(errorLine(host)).toBeNull()
  // The stale badge says which file the rule cites, not where its page is.
  const badge = host.querySelector('.vr-row:nth-child(2) .vr-badge-stale')
  expect(badge?.getAttribute('title')).toBe('stale: cites a file gone at HEAD: src/old.ts')

  await click(rawButton(host))
  await flush()
  const status = rawBlock(host, 'mnemo status')!
  const doctor = rawBlock(host, 'mnemo doctor')!
  // Lines no tile reads are printed as they came, the table none the worse.
  for (const line of ['Recall rerank: typesafe, key from secrets', 'Auto-brain:', '  rerank: 218 calls in 14d, 214 ok, 1 error, 3 small'])
    expect(status.querySelector('pre')?.textContent).toContain(line)
  expect(doctor.querySelector('pre')?.textContent).toBe(doctorText.trimEnd())
  expect(doctor.querySelector('.vh-fail')).toBeNull()
  expect(doctor.querySelector('.vt-error')).toBeNull()
  await unmount()
})

test('a status line no version of mnemo printed before shows in the raw panel and breaks nothing', async () => {
  const novel = `${statusText}Sync: 3 of 5 slots in use (beta)\n☃ something new\n`
  answers.health = async () => healthOf({ status: ran(novel) })
  answers.doctor = async () => ran(`${doctorText}  ✦ a check kind nobody has seen yet: 12 things\n`)
  const { host, unmount } = await mount()
  expect(tiles(host)).toHaveLength(6)
  expect(names(host)).toEqual(['Run the tests', 'target-dir'])
  await click(rawButton(host))
  await flush()
  expect(rawBlock(host, 'mnemo status')?.textContent).toContain('Sync: 3 of 5 slots in use (beta)\n☃ something new')
  expect(rawBlock(host, 'mnemo doctor')?.textContent).toContain('✦ a check kind nobody has seen yet: 12 things')
  await unmount()
})

test('an empty vault: the breaker alone, zero to review, and a table that says why it is empty', async () => {
  answers.rules = []
  answers.health = async () => healthOf({ status: ran(emptyStatusText), tiles: [tile('breaker', 'circuit breaker', 'closed', 'ok', 'ok')], pages: 0 })
  answers.stale = ran('[]')
  answers.doctor = async () => ran('Install scope: global — ~/.claude/settings.json\nRunning diagnostic / preflight checks…\nOK\n')
  const { host, unmount } = await mount()
  expect(tiles(host)).toEqual(['closedcircuit breaker', '0needs review', '0inbox'])
  expect(host.querySelector('.vr-table')?.textContent).toBe('No rules: `mnemo status` names no vault, or it holds no pages.')
  expect(host.querySelector('.vr-bar .vt-count')?.textContent).toBe('0 rules')
  await click(rawButton(host))
  await flush()
  expect(rawBlock(host, 'mnemo status')?.querySelector('pre')?.textContent).toBe(emptyStatusText.trimEnd())
  expect(rawBlock(host, 'mnemo doctor')?.querySelector('pre')?.textContent).toContain('OK')
  await unmount()
})

test('a status that fails shows why above the table, and its exit in the raw panel', async () => {
  // As `vault_health` sends it: the error names the status that failed.
  const status = ran('', 1, "Traceback (most recent call last):\n  ...\nKeyError: 'vault'\n")
  answers.health = async () => healthOf({ status, tiles: [], error: "`mnemo status` exited 1: KeyError: 'vault'" })
  const { host, unmount } = await mount()
  expect(errorLine(host)?.textContent).toContain("`mnemo status` exited 1: KeyError: 'vault'")
  // No status tiles; review (from `mnemo stale`) and the inbox are read apart from status.
  expect(tiles(host)).toEqual(['1needs review', '0inbox'])
  // So is the table, and it still shows.
  expect(names(host)).toEqual(['Run the tests', 'target-dir'])
  await click(rawButton(host))
  await flush()
  const block = rawBlock(host, 'mnemo status')!
  expect(block.querySelector('.vh-fail')?.textContent).toBe(' exit 1')
  expect(block.querySelector('pre.vt-error')?.textContent).toContain("KeyError: 'vault'")
  await unmount()
})

test('a health read that throws shows its message, and ↻ reads again', async () => {
  answers.health = async () => Promise.reject('vault_health: the command panicked')
  const { host, unmount } = await mount()
  expect(errorLine(host)?.textContent).toContain('vault_health: the command panicked')
  answers.health = async () => healthOf()
  await click(host.querySelector('.vr-strip button[title="Re-run status and stale"]'))
  await flush()
  expect(errorLine(host)).toBeNull()
  expect(tiles(host)).toHaveLength(6)
  await unmount()
})

test.each([
  ['exits 1', async () => ran(`${doctorText.replace('Warnings above.', '')}  ✗ hooks: 2 of 4 missing\nIssues found above.\n`, 1), ' exit 1', 'Issues found above.'],
  ['is stopped at its timeout', async () => ran('', null, 'mnemo doctor gave no answer in 300s and was stopped'), ' failed', 'gave no answer in 300s'],
  ['cannot start', async () => ran('', null, 'mnemo: No such file or directory (os error 2)'), ' failed', 'No such file or directory'],
  ['throws', async () => Promise.reject('vault_doctor: ipc closed'), ' failed', 'vault_doctor: ipc closed'],
])('a doctor that %s says so in red, its message in full', async (_, doctor, label, message) => {
  answers.doctor = doctor
  const { host, unmount } = await mount()
  await click(rawButton(host))
  await flush()
  const block = rawBlock(host, 'mnemo doctor')!
  expect(block.querySelector('.vh-fail')?.textContent).toBe(label)
  expect(block.querySelector('pre.vt-error')?.textContent).toContain(message)
  expect(host.querySelector('.vh-doctor-running')).toBeNull()
  await unmount()
})

test('while doctor runs the panel counts its seconds, and the rest of the screen keeps working', async () => {
  // Date and the tick only: promises and setTimeout stay real, so reads still land.
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  try {
    const run = deferred<RunResult>()
    answers.doctor = () => run.promise
    const { host, unmount } = await mount()
    await click(rawButton(host))
    await flush()
    const running = () => host.querySelector('.vh-doctor-running')
    expect(running()?.getAttribute('role')).toBe('status')
    expect(running()?.textContent).toBe('running mnemo doctor… 0s')
    // The status half is there already: it does not wait on doctor.
    expect(rawBlock(host, 'mnemo status')?.textContent).toContain('Circuit breaker: closed (ok)')
    await act(async () => vi.advanceTimersByTime(26_000))
    expect(running()?.textContent).toBe('running mnemo doctor… 26s')

    // Rows open, the filter takes typing, ↻ re-reads health: none of it waits.
    await click(byText(host, '.vr-name-main', 'target-dir')!.closest('tr'))
    await flush()
    expect(host.querySelector('.vr-side .vt-title')?.textContent).toBe('target-dir')
    const before = calls.filter((c) => c === 'vault_health').length
    await click(host.querySelector('.vr-strip button[title="Re-run status and stale"]'))
    await flush()
    expect(calls.filter((c) => c === 'vault_health')).toHaveLength(before + 1)
    expect(tiles(host)).toHaveLength(6)

    // Closed and opened again, it is the same run, counted from its start.
    await click(rawButton(host))
    await act(async () => vi.advanceTimersByTime(40_000))
    await click(rawButton(host))
    await flush()
    expect(running()?.textContent).toBe('running mnemo doctor… 1m 06s')
    expect(doctorCalls()).toBe(1)

    await act(async () => run.resolve(ran(doctorText)))
    await flush()
    expect(running()).toBeNull()
    expect(rawBlock(host, 'mnemo doctor')?.textContent).toContain('Warnings above.')
    await unmount()
  } finally {
    vi.useRealTimers()
  }
})

test('↻ with the panel open runs doctor again rather than leaving "running" up with nothing running', async () => {
  const { host, unmount } = await mount()
  await click(rawButton(host))
  await flush()
  expect(rawBlock(host, 'mnemo doctor')?.textContent).toContain('Warnings above.')
  expect(doctorCalls()).toBe(1)

  answers.doctor = async () => ran('Running diagnostic / preflight checks…\nOK\n')
  await click(host.querySelector('.vr-strip button[title="Re-run status and stale"]'))
  await flush()
  await flush()
  expect(doctorCalls()).toBe(2)
  expect(host.querySelector('.vh-doctor-running')).toBeNull()
  expect(rawBlock(host, 'mnemo doctor')?.querySelector('pre')?.textContent).toContain('OK')

  // Closed, a re-read leaves doctor for the next time the panel opens.
  await click(rawButton(host))
  await click(host.querySelector('.vr-strip button[title="Re-run status and stale"]'))
  await flush()
  expect(doctorCalls()).toBe(2)
  await click(rawButton(host))
  await flush()
  expect(doctorCalls()).toBe(3)
  await unmount()
})

test('elapsed time reads in seconds, then minutes', async () => {
  const { elapsedText } = await import('./HealthTable')
  expect([0, 999, 26_400, 59_999, 60_000, 66_000, 605_000].map(elapsedText)).toEqual(['0s', '0s', '26s', '59s', '1m 00s', '1m 06s', '10m 05s'])
})
