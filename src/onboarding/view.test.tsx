import { act } from 'react'
import dryRun from '../learned/fixtures/dry-run.json?raw'
import listing from '../learned/fixtures/listing.json?raw'
import progress from '../learned/fixtures/progress.jsonl?raw'
import type { ToolName, ToolStatus } from '../setup/tools'

const t = vi.hoisted(() => ({
  calls: [] as [string, Record<string, unknown> | undefined][],
  status: [] as ToolStatus[],
  install: null as null | (() => Promise<string>),
  answers: {} as Record<string, string[]>,
  on: {} as Record<string, ((e: { payload: unknown }) => void)[]>,
  pane: 0,
}))
vi.mock('@tauri-apps/api/core', () => ({
  Channel: class {},
  invoke: async (cmd: string, args?: Record<string, unknown>) => {
    t.calls.push([cmd, args])
    if (cmd === 'tools_status') return t.status
    if (cmd === 'tools_install_mnemo') return t.install!()
    if (cmd === 'pty_spawn') return ++t.pane
    if (cmd === 'gh_auth') return { installed: false, logged: false, login: null, scopes: [] }
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

const tool = (name: ToolName, path: string | null): ToolStatus => ({ name, path, version: path && `${name} 1.0`, managed: false })
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))
const click = (el: Element | null | undefined) => act(() => void (el as HTMLElement).click())
const button = (el: Element, text: string | RegExp) =>
  [...el.querySelectorAll('button')].find((b) => (typeof text === 'string' ? b.textContent === text : text.test(b.textContent ?? '')))
const called = (cmd: string) => t.calls.filter(([c]) => c === cmd).map(([, a]) => a)
const emit = async (name: string, payload: unknown) => {
  await act(async () => (t.on[name] ?? []).forEach((h) => h({ payload })))
}
const dialog = () => document.querySelector<HTMLElement>('[data-onboarding]')
const noPages = JSON.stringify({ project: 'clubinho', origin: 'backfill', pages: [] })

// The first import pulls in the app's stores and the UI kit: slow on a cold cache.
beforeAll(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // The dialog mounts itself in the shell's overlay slot; the shell is not rendered here, so
  // draw that slot on its own.
  await act(async () => {
    await import('./view')
    const { SlotOutlet } = await import('../shell/Slot')
    const { createRoot } = await import('react-dom/client')
    createRoot(document.body.appendChild(document.createElement('div'))).render(<SlotOutlet slot="overlay" />)
  })
}, 120_000)

beforeEach(async () => {
  t.calls = []
  t.answers = {}
  const { onboarding } = await import('./app-store')
  act(() => onboarding.getState().close())
  await flush()
})

async function openFromPalette() {
  await import('./view')
  const { all } = await import('../actions/registry')
  const action = all().find((a) => a.id === 'onboarding.open')!
  await act(() => action.run())
  await flush()
}

test('the palette opens it at setup, drawn over the app, and it looks at the tools again', async () => {
  t.status = [tool('git', '/usr/bin/git'), tool('claude', '/bin/claude'), tool('mnemo', '/bin/mnemo'), tool('gh', null)]
  await import('./view')
  expect(dialog()).toBeNull()
  await openFromPalette()
  expect(dialog()?.dataset.onboarding).toBe('setup')
  expect(called('tools_status').length).toBeGreaterThan(0)
  const rows = [...dialog()!.querySelectorAll('[data-tool]')].map((r) => [r.getAttribute('data-tool'), r.hasAttribute('data-found')])
  expect(rows).toEqual([
    ['git', true],
    ['claude', true],
    ['mnemo', true],
    ['gh', false],
  ])
  expect(dialog()!.textContent).toContain('Claude Code and mnemo are in place. The rest is optional.')
  expect(button(dialog()!, 'Install gh')).toBeTruthy()
  expect(button(dialog()!, 'Continue')!.disabled).toBe(false)
})

test('with mnemo missing, Continue waits; mnemo installs in the dialog and it checks again', async () => {
  t.status = [tool('git', '/usr/bin/git'), tool('claude', '/bin/claude'), tool('mnemo', null), tool('gh', '/bin/gh')]
  let done = (_: string) => {}
  t.install = () => new Promise((r) => (done = r))
  await openFromPalette()
  expect(button(dialog()!, 'Continue')!.disabled).toBe(true)
  expect(dialog()!.textContent).toContain('Claude Code and mnemo are both needed.')

  await click(button(dialog()!, 'Install mnemo'))
  await flush()
  expect(button(dialog()!, 'Installing…')!.disabled).toBe(true)
  await emit('tools-install', { tool: 'mnemo', message: 'downloading mnemo 0.9.0' })
  expect(dialog()!.querySelector('[data-run]')!.textContent).toContain('downloading mnemo 0.9.0')

  t.status = [tool('git', '/usr/bin/git'), tool('claude', '/bin/claude'), tool('mnemo', '/app/bin/mnemo'), tool('gh', '/bin/gh')]
  const checks = called('tools_status').length
  await act(async () => done('v0.9.0'))
  await flush()
  expect(called('tools_status').length).toBe(checks + 1)
  expect(dialog()!.textContent).toContain('mnemo v0.9.0 installed')
  expect(dialog()!.textContent).toContain('Everything is in place.')
  expect(button(dialog()!, 'Continue')!.disabled).toBe(false)
})

test('Claude Code installs in a terminal tab: the dialog steps aside and comes back when the user leaves it', async () => {
  t.status = [tool('git', '/usr/bin/git'), tool('claude', null), tool('mnemo', '/bin/mnemo'), tool('gh', '/bin/gh')]
  const { store } = await import('../layout/app-store')
  await openFromPalette()
  const before = store.getState().tabs.length
  await click(button(dialog()!, 'Install Claude Code'))
  await flush()
  expect(dialog()).toBeNull()
  expect(store.getState().tabs).toHaveLength(before + 1)
  expect(called('pty_spawn')).toHaveLength(1)

  const checks = called('tools_status').length
  t.status = [tool('git', '/usr/bin/git'), tool('claude', '/bin/claude'), tool('mnemo', '/bin/mnemo'), tool('gh', '/bin/gh')]
  act(() => store.getState().showHome())
  await flush()
  expect(dialog()?.dataset.onboarding).toBe('setup')
  expect(called('tools_status').length).toBe(checks + 1)
  expect(dialog()!.querySelector('[data-tool="claude"]')!.hasAttribute('data-found')).toBe(true)
})

test('Continue reaches the consent for the open repo; yes starts the run, and the review decides in the dialog', async () => {
  t.status = [tool('git', '/usr/bin/git'), tool('claude', '/bin/claude'), tool('mnemo', '/bin/mnemo'), tool('gh', '/bin/gh')]
  const { store } = await import('../layout/app-store')
  const { homeStore } = await import('../home/app-store')
  const { learned } = await import('../learned/app-store')
  act(() => store.getState().showHome())
  homeStore.setState({ selected: '/r/clubinho' })
  learned.setState({ target: null, phase: { kind: 'idle' }, pages: [], checked: {}, expanded: {}, openedAt: null })
  t.answers = { list: [noPages, listing], 'dry-run': [dryRun] }
  await openFromPalette()
  await click(button(dialog()!, 'Continue'))
  await flush()
  expect(dialog()?.dataset.onboarding).toBe('learned')
  expect(called('install_review_project')).toEqual([{ cwd: '/r/clubinho' }])
  expect(dialog()!.textContent).toContain('mnemo can read your last 44 sessions in clubinho and learn from them. About 19 model calls on your Claude plan.')
  expect(called('install_review_run')).toEqual([])

  await click(button(dialog()!, 'Read my history'))
  await flush()
  expect(called('install_review_run')).toEqual([{ project: 'clubinho', root: '/r/clubinho' }])
  const lines = progress.split('\n').filter(Boolean)
  await emit('job-line', { id: 'install-review:clubinho', stream: 'out', line: lines[1] })
  expect(dialog()!.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('7')
  expect(button(dialog()!, 'Close')).toBeTruthy()

  await emit('job-line', { id: 'install-review:clubinho', stream: 'out', line: lines.at(-1)! })
  await emit('job-exit', { id: 'install-review:clubinho', code: 0 })
  await flush()
  expect(dialog()!.querySelectorAll('[data-key]')).toHaveLength(5)
  expect(dialog()!.textContent).toContain('mnemo learned 5 pages from your history.')
  const staging = dialog()!.querySelector('[data-key="project/clubinho__staging-db-is-shared"]')!
  await act(() => void staging.querySelector<HTMLInputElement>('input')!.click())
  expect(button(dialog()!, 'Keep selected (4)')).toBeTruthy()
  await click(button(dialog()!, 'Decide later'))
  await flush()
  expect(dialog()!.textContent).toContain('Nothing decided.')
  expect(called('install_review_record')).toEqual([{ project: 'clubinho', decision: 'later' }])
  await click(button(dialog()!, 'Done'))
  await flush()
  expect(dialog()).toBeNull()
})

test("the review's launch check opens the dialog at the consent, and never jumps one open at setup", async () => {
  const { onboarding } = await import('./app-store')
  await import('./view')
  act(() => onboarding.getState().show('setup'))
  act(() => onboarding.getState().offer('learned'))
  await flush()
  expect(dialog()?.dataset.onboarding).toBe('setup')
  act(() => onboarding.getState().close())
  act(() => onboarding.getState().offer('learned'))
  await flush()
  expect(dialog()?.dataset.onboarding).toBe('learned')
})

test('opening by itself focuses the dialog, not a button an Enter would press', async () => {
  const { onboarding } = await import('./app-store')
  act(() => onboarding.getState().offer('learned'))
  await flush()
  expect(document.activeElement).toBe(dialog())
})
