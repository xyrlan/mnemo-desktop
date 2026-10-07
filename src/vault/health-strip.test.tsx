import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Health, Page, RuleRow, RunResult, Tile } from './types'

// HealthTable mounted on its own, `invoke` mocked, fed what `mnemo status` and `mnemo doctor`
// print on a real vault (mnemo 1.7.0, 2026-10-07, paths shortened). The tiles are what Rust's
// `parse_tiles` makes of that status; the raw text is shown as printed.

const STATUS = `Vault: /Users/x/mnemo  (exists)
Briefings: 954 across 19 agents (5.9 MB) — 0 prunable (retention 180d, keep 20/agent)
Hooks (global): 4/4 — /Users/x/.claude/settings.json
Circuit breaker: closed (ok)
Error log: /Users/x/mnemo/.errors.log (91458 bytes)
Frobnication: 3 widgets (a line this version of the app has never seen)

Reflex: enabled (51 emissions today)

Numbers (last 14 days):
  reflex: injected on 747 of 2266 prompts (33.0%)
  recall: primacy@5 47.6% over 166 cases (mnemo recall, 2026-10-03)
`
const TILES: Tile[] = [
  { key: 'briefings', label: 'briefings', value: '954', detail: 'across 19 agents (5.9 MB)', tone: 'muted' },
  { key: 'breaker', label: 'circuit breaker', value: 'closed', detail: 'ok', tone: 'ok' },
  { key: 'reflex', label: 'reflex injected', value: '33.0%', detail: '747 of 2266 prompts', tone: 'muted' },
  { key: 'recall', label: 'recall primacy@5', value: '47.6%', detail: 'over 166 cases', tone: 'muted' },
  // A second line under a known key, and a tone this side has no colour for: both still draw.
  { key: 'recall', label: 'recall primacy@10', value: '61.0%', detail: 'over 166 cases', tone: 'frobbed' as Tile['tone'] },
]
const DOCTOR = `Install scope: global — ~/.claude/settings.json
Running diagnostic / preflight checks…
  ✓ circuit breaker closed (2 errors in the last hour, most from briefing.corrections_rejected; 2 of 10 strikes)
  ⚠ 734 staged pages awaiting review in shared/_inbox/ (oldest confirmation-dialog-before-delete.md, 34 days)
       → \`mnemo inbox\` lists them; \`--promote KEY\` moves one into shared/<type>/, \`--drop KEY\` archives it
  ⁂ quorum: a check this app has never seen
  ℹ Recall: primacy@5 = 47.6% over 166 cases (measured 2026-10-03T03:17:03Z)
Warnings above.
`

const ran = (stdout: string, code: number | null = 0, stderr = ''): RunResult => ({ stdout, stderr, code })
const dir = '/Users/x/mnemo/shared/feedback'
const row = (slug: string): RuleRow => ({
  path: `${dir}/${slug}.md`,
  slug,
  name: slug,
  description: '',
  type: 'feedback',
  agent: 'shared',
  confidence: 'verified',
  topics: [],
  fires: 1,
  last_fired: null,
  heat: 1,
  badges: [],
  reasons: [],
})
const healthy: Health = { root: '/Users/x/mnemo', status: ran(STATUS), tiles: TILES, label_only: [], dormant: [], pages: 2, never_fired: 0, inbox: 3, error: null }

// What each command answers: a value, a promise (held open by the test), or an Error to reject with.
type Answer = unknown | Promise<unknown> | Error
const answers: Record<string, Answer> = {}
const calls: string[] = []
const reset = () =>
  Object.assign(answers, {
    vault_rules: [row('first'), row('second')],
    vault_health: healthy,
    vault_doctor: ran(DOCTOR),
    vault_run: ran('[]'),
  })

vi.mock('@tauri-apps/api/core', () => ({
  Channel: class {},
  invoke: async (cmd: string, args?: Record<string, unknown>) => {
    calls.push(cmd)
    if (cmd === 'vault_page') return { ...row(String(args!.path).split('/').pop()!.replace('.md', '')), modified: null, body: 'body', runtime: null, frontmatter: [], error: null } satisfies Page
    const a = await answers[cmd]
    if (a instanceof Error) throw a.message
    return a
  },
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))

const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))
const click = (el: Element | null | undefined) => act(() => void (el as HTMLElement).click())
const button = (host: HTMLElement, text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === text)
const tiles = (host: HTMLElement) => [...host.querySelectorAll('.vr-strip .vh-tile')].map((t) => t.textContent)
const raw = (host: HTMLElement) => host.querySelector('.vr-raw')
const rawBlock = (host: HTMLElement, title: string) => [...host.querySelectorAll('.vr-raw-block')].find((b) => b.querySelector('.vr-raw-title')?.textContent?.startsWith(title))
const errorLine = (host: HTMLElement) => host.querySelector('.vr > .vt-error-line')?.textContent ?? null
const refresh = (host: HTMLElement) => click(host.querySelector('.vr-strip button[title="Re-run status and stale"]'))

let unmount: (() => Promise<void>) | null = null

async function mount() {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const { vault } = await import('./app-store')
  vault.setState({ health: null, healthLoading: false, doctor: null, doctorLoading: false, doctorSince: null, rules: [], rulesLoaded: false, selected: null, page: null, filter: '', scope: '' })
  const { HealthTable } = await import('./HealthTable')
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => root.render(<HealthTable cwd="/repo" current={undefined} />))
  await flush()
  unmount = async () => {
    await act(async () => root.unmount())
    host.remove()
  }
  return host
}

beforeEach(() => {
  calls.length = 0
  reset()
})
afterEach(async () => {
  vi.useRealTimers()
  await unmount?.()
  unmount = null
})

test('status draws a tile per number it carries, unknown lines and tones included, and prints as is in the panel', async () => {
  const host = await mount()
  expect(tiles(host)).toEqual(['954briefings', 'closedcircuit breaker', '33.0%reflex injected', '47.6%recall primacy@5', '61.0%recall primacy@10', '0needs review', '3inbox'])
  // Only states that ask for something get a dot; an unknown tone gets none rather than breaking.
  expect([...host.querySelectorAll('.vh-tile')].map((t) => !!t.querySelector('.vh-tile-label > *'))).toEqual([false, true, false, false, false, true, true])
  expect(errorLine(host)).toBeNull()
  expect(calls).not.toContain('vault_doctor')

  await click(button(host, 'status / doctor'))
  await flush()
  // The status line no tile knows is printed, nothing dropped.
  expect(rawBlock(host, 'mnemo status')?.querySelector('pre')?.textContent).toBe(STATUS.trimEnd())
  const doctor = rawBlock(host, 'mnemo doctor')!
  expect(doctor.querySelector('pre')?.textContent).toBe(DOCTOR.trimEnd())
  expect(doctor.querySelector('pre')?.className).not.toContain('vt-error')
  expect(doctor.querySelector('.vh-fail')).toBeNull()
  expect(calls.filter((c) => c === 'vault_doctor')).toHaveLength(1)

  // Closing and opening again shows the doctor already read.
  await click(button(host, 'status / doctor'))
  expect(raw(host)).toBeNull()
  await click(button(host, 'status / doctor'))
  await flush()
  expect(calls.filter((c) => c === 'vault_doctor')).toHaveLength(1)
  expect(rawBlock(host, 'mnemo doctor')?.querySelector('pre')?.textContent).toContain('⁂ quorum')
})

test('while doctor runs the panel says so with its elapsed time, and the rest of the screen works', async () => {
  let finish!: (r: RunResult) => void
  answers.vault_doctor = new Promise<RunResult>((r) => (finish = r))
  const host = await mount()
  // Only the clock is faked: setTimeout stays real for `flush`.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
  await click(button(host, 'status / doctor'))
  await flush()
  const running = () => raw(host)?.querySelector('.vh-running')
  expect(running()?.getAttribute('role')).toBe('status')
  expect(running()?.textContent).toBe('running mnemo doctor… 0 s')
  await act(async () => vi.advanceTimersByTime(26_000))
  expect(running()?.textContent).toBe('running mnemo doctor… 26 s')
  // Status is already there beside it.
  expect(rawBlock(host, 'mnemo status')?.textContent).toContain('Circuit breaker: closed (ok)')

  // Rows open, the filter reads, and status re-runs, all while doctor is out.
  await click(host.querySelector('.vr-row'))
  await flush()
  expect(host.querySelector('.vr-side .vt-title')?.textContent).toBe('first')
  await refresh(host)
  await flush()
  expect(calls.filter((c) => c === 'vault_health')).toHaveLength(2)
  // The re-read does not start a second doctor while the first is still running.
  expect(calls.filter((c) => c === 'vault_doctor')).toHaveLength(1)

  await act(async () => finish(ran(DOCTOR)))
  await flush()
  expect(running()).toBeFalsy()
  expect(rawBlock(host, 'mnemo doctor')?.querySelector('pre')?.textContent).toBe(DOCTOR.trimEnd())
})

test('a doctor that exits non-zero, is stopped, or cannot be run shows why, and ↻ runs it again', async () => {
  answers.vault_doctor = ran('Running diagnostic / preflight checks…\n  ✗ vault root missing: /Users/x/mnemo\nIssues found above.\n', 1)
  const host = await mount()
  await click(button(host, 'status / doctor'))
  await flush()
  let doctor = rawBlock(host, 'mnemo doctor')!
  expect(doctor.querySelector('.vh-fail')?.textContent).toBe(' exit 1')
  expect(doctor.querySelector('pre.vt-error')?.textContent).toContain('✗ vault root missing: /Users/x/mnemo')

  // Re-reading with the panel open drops the old doctor and runs it again; before, the panel
  // said "running mnemo doctor…" for ever and nothing ran.
  answers.vault_doctor = ran('', null, 'mnemo doctor gave no answer in 300s and was stopped')
  await refresh(host)
  await flush()
  expect(calls.filter((c) => c === 'vault_doctor')).toHaveLength(2)
  doctor = rawBlock(host, 'mnemo doctor')!
  expect(doctor.querySelector('.vh-fail')?.textContent).toBe(' did not finish')
  expect(doctor.querySelector('pre')?.textContent).toBe('mnemo doctor gave no answer in 300s and was stopped')

  answers.vault_doctor = new Error('command vault_doctor not found')
  await refresh(host)
  await flush()
  doctor = rawBlock(host, 'mnemo doctor')!
  expect(doctor.querySelector('.vh-fail')?.textContent).toBe(' did not finish')
  expect(doctor.querySelector('pre')?.textContent).toBe('command vault_doctor not found')
  expect(raw(host)?.querySelector('.vh-running')).toBeNull()
})

test('an empty vault is an empty table and zero tiles, not an error', async () => {
  answers.vault_rules = []
  answers.vault_health = { ...healthy, status: ran('Vault: /Users/x/mnemo  (exists)\nCircuit breaker: closed (ok)\n'), tiles: [TILES[1]], pages: 0, inbox: 0 } satisfies Health
  const host = await mount()
  expect(tiles(host)).toEqual(['closedcircuit breaker', '0needs review', '0inbox'])
  expect(host.querySelector('.vr-table')?.textContent).toBe('No rules: `mnemo status` names no vault, or it holds no pages.')
  expect(host.querySelector('.vr-bar .vt-count')?.textContent).toBe('0 rules')
  expect(errorLine(host)).toBeNull()
})

test('a failed status is an error line, whether mnemo fails, the vault is missing, or the call rejects', async () => {
  // The vault was found another way (a cached root, ~/mnemo), so Rust sets no error: the only
  // sign was missing tiles.
  answers.vault_health = { ...healthy, status: ran('', null, 'mnemo: No such file or directory (os error 2)'), tiles: [] } satisfies Health
  let host = await mount()
  expect(errorLine(host)).toBe('mnemo status did not finish: mnemo: No such file or directory (os error 2)')
  expect(tiles(host)).toEqual(['0needs review', '3inbox'])
  await click(button(host, 'status / doctor'))
  await flush()
  expect(rawBlock(host, 'mnemo status')?.querySelector('.vh-fail')?.textContent).toBe(' did not finish')
  // Dismissed, it stays away until the next read, which brings its own.
  await click(host.querySelector('.vr > .vt-error-line button'))
  expect(errorLine(host)).toBeNull()
  answers.vault_health = { ...healthy, status: ran('Traceback (most recent call last):\n  …\nKeyError: x\n', 1), tiles: [] } satisfies Health
  await refresh(host)
  await flush()
  expect(errorLine(host)).toBe('mnemo status exit 1: Traceback (most recent call last):')
  await unmount!()

  // Rust's own error wins over the status line.
  answers.vault_health = { ...healthy, root: null, status: ran('', 2, 'no vault'), tiles: [], error: 'no mnemo vault found (`mnemo status` names none)' } satisfies Health
  host = await mount()
  expect(errorLine(host)).toBe('no mnemo vault found (`mnemo status` names none)')
  await unmount!()

  answers.vault_health = new Error('vault_health: the app is gone')
  host = await mount()
  expect(errorLine(host)).toBe('vault_health: the app is gone')
  // A rejected read is still a health (empty, with the error), so the panel opens to show it.
  expect((button(host, 'status / doctor') as HTMLButtonElement).disabled).toBe(false)
})
