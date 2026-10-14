import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { PulseEvent } from '../pulse/types'
import { HoverCard, tokensWord } from './HoverCard'
import { child, nexus, robot } from './interact-fixtures'
import type { Target } from './types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// `injectedRules` is the memory piece's; the card only lists what it gives.
const rules = vi.hoisted(() => ({ asked: [] as string[], give: [] as string[] }))
vi.mock('./packets', () => ({
  injectedRules: (_events: PulseEvent[], sessionId: string) => {
    rules.asked.push(sessionId)
    return rules.give
  },
}))

const NOW = Date.parse('2026-10-14T12:00:00Z')

async function draw(target: Target, events: PulseEvent[] = []): Promise<HTMLElement> {
  const host = document.body.appendChild(document.createElement('div'))
  await act(async () => createRoot(host).render(<HoverCard target={target} events={events} now={NOW} />))
  return host
}
const row = (host: HTMLElement, name: string) => host.querySelector(`[data-row="${name}"] dd`)?.textContent ?? null

afterEach(() => {
  document.body.innerHTML = ''
  rules.asked = []
  rules.give = []
})

test('a robot: label and title, model and effort, state, tool, age, PR and checks, context and rules', async () => {
  rules.give = ['testing__run-pnpm-test', 'react__no-effect-chains']
  const r = robot({
    label: '#643',
    tool: 'Bash',
    child: child({
      name: 'nexus hover card',
      model: 'opus[1m]',
      effort: 'high',
      tokens: 42_300,
      updated_at: '2026-10-14T11:56:00Z',
      pr: { number: 401, url: 'https://example.invalid/pr/401', state: 'OPEN', head: 'feat/nexus/interact', ci: 'fail', failing: ['test (windows)'] },
    }),
  })
  const host = await draw({ kind: 'robot', robot: r })
  expect(host.textContent).toContain('#643')
  expect(host.textContent).toContain('nexus hover card')
  expect(row(host, 'model')).toBe('opus[1m] · effort high')
  expect(row(host, 'state')).toBe('active')
  expect(row(host, 'tool')).toBe('Bash')
  expect(row(host, 'age')).toBe('4m')
  expect(row(host, 'PR')).toBe('#401 open · checks failing: test (windows)')
  expect(row(host, 'context')).toBe('42k tokens')
  expect([...host.querySelectorAll('[data-row="rules"] li')].map((li) => li.textContent)).toEqual(rules.give)
  expect(rules.asked).toEqual([r.sessionId])
})

test('a robot that needs you says what it waits on; a rate-limited one says its reset', async () => {
  const waiting = robot({ halo: 'needs-you', badge: 'alert', child: child({ tempo: 'blocked', waiting_for: 'permission prompt' }) })
  expect(row(await draw({ kind: 'robot', robot: waiting }), 'state')).toBe('blocked: permission prompt')
  const sleeping = robot({ pose: 'sleeping', badge: 'zzz', halo: null, child: child({ detail: 'resets 3pm' }) })
  expect(row(await draw({ kind: 'robot', robot: sleeping }), 'state')).toBe('rate-limited: resets 3pm')
})

test('a robot with no model, effort, session or rules says so', async () => {
  const host = await draw({ kind: 'robot', robot: robot({ sessionId: null, child: child({ model: null, effort: null }) }) })
  expect(row(host, 'model')).toBe('default · effort default')
  expect(row(host, 'rules')).toBe('none injected')
  expect(row(host, 'tool')).toBeNull()
  expect(row(host, 'PR')).toBeNull()
  expect(rules.asked).toEqual([])
})

test('a nexus: its session and its robots', async () => {
  const n = nexus({
    label: 'nexus round',
    pose: 'waiting',
    parent: { session_id: '22222222-0000-4000-8000-000000000002', pid: 1, name: null, status: 'waiting', cwd: '/work/mnemo-desktop', waiting_for: 'input needed' },
    robots: [robot({ id: 'r1', label: '#7' }), robot({ id: 'r2', label: 'world', child: child({ id: 'r2', state: 'done' }) })],
  })
  const host = await draw({ kind: 'nexus', nexus: n })
  expect(host.textContent).toContain('nexus round')
  expect(row(host, 'session')).toBe('22222222')
  expect(row(host, 'state')).toBe('waiting on you: input needed')
  expect([...host.querySelectorAll('[data-row="robots"] li')].map((li) => li.textContent)).toEqual(['#7 · active', 'world · done'])
})

test('a dead nexus with no robots', async () => {
  const host = await draw({ kind: 'nexus', nexus: nexus({ pose: 'dead', parent: null, robots: [] }) })
  expect(row(host, 'state')).toBe('ended')
  expect(row(host, 'robots')).toBe('none')
})

test('an archive: its pages', async () => {
  const host = await draw({ kind: 'archive', root: '/work/mnemo-desktop', archive: { project: 'mnemo', pages: 1, tier: 0 } })
  expect(host.textContent).toContain('mnemo')
  expect(row(host, 'pages')).toBe('1 live page · small')
})

test('token counts read at a glance', () => {
  expect([812, 42_300, 1_000_000, 1_340_000].map(tokensWord)).toEqual(['812', '42k', '1M', '1.3M'])
})
