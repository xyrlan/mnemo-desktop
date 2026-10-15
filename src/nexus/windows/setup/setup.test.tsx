import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { setup } from '../../../setup/app-store'
import { IDLE_RUN, NOT_ASKED } from '../../../setup/store'
import { installRoute, osOf, type ToolStatus } from '../../../setup/tools'
import { WindowHost } from '../../ui/Window'
import { closeWindow, openWindow, windowStore, windowsIn } from '../../ui/windows'
import './index'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** The commands the window asks, by name; one answering an Error rejects. */
const tauri = vi.hoisted(() => ({ answers: {} as Record<string, unknown>, calls: [] as string[] }))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string) => {
    tauri.calls.push(cmd)
    const a = tauri.answers[cmd]
    if (a instanceof Error) throw a
    return typeof a === 'function' ? (a as () => unknown)() : a
  },
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))
const opened = vi.hoisted(() => ({ specs: [] as unknown[], refuse: null as string | null }))
vi.mock('../../drawer/open', () => ({
  openSession: async (spec: unknown) => {
    if (opened.refuse) throw new Error(opened.refuse)
    opened.specs.push(spec)
  },
}))
vi.mock('@tauri-apps/api/path', () => ({ homeDir: async () => '/Users/me' }))

const row = (name: ToolStatus['name'], path: string | null, more: Partial<ToolStatus> = {}): ToolStatus => ({ name, path, version: path ? `${name} 1.0.0` : null, managed: false, ...more })

let unmount: () => Promise<void>

async function render(rows: ToolStatus[]) {
  tauri.answers.tools_status = rows
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () => root.render(<WindowHost />))
  await act(async () => openWindow('setup'))
  await act(async () => new Promise((r) => setTimeout(r, 0)))
  unmount = () => act(async () => root.unmount())
}

beforeEach(() => {
  setup.setState({ rows: null, checking: false, statusError: null, mnemo: IDLE_RUN, path: IDLE_RUN, latest: NOT_ASKED })
  tauri.answers = {}
  tauri.calls = []
  opened.specs = []
  opened.refuse = null
})
afterEach(async () => {
  await unmount?.()
  closeWindow()
  document.body.innerHTML = ''
})

const win = () => document.querySelector<HTMLElement>('[data-nx-window]')!
const tool = (name: string) => win().querySelector<HTMLElement>(`[data-tool="${name}"]`)!
const buttonIn = (el: ParentNode, text: string) => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text)

test('Setup is a SYSTEMS window, first of the three this piece adds', () => {
  const w = windowsIn('systems').find((d) => d.id === 'setup')!
  expect(w.title).toBe('Setup')
  expect(w.order).toBe(30)
})

test('opened, it checks again, and lists each program found or missing, the needed ones marked', async () => {
  await render([row('git', '/usr/bin/git'), row('claude', null), row('mnemo', '/Users/me/.mnemo-desktop/bin/mnemo', { managed: true }), row('gh', null)])
  expect(tauri.calls).toContain('tools_status')
  expect(win().querySelector('.nx-su-summary')!.textContent).toBe('claude and mnemo are both needed. Install what is missing, one click each.')
  expect(tool('git').dataset.state).toBe('found')
  expect(tool('git').textContent).toContain('/usr/bin/git')
  expect(tool('claude').dataset.state).toBe('needed')
  expect(tool('gh').dataset.state).toBe('missing')
  expect(tool('mnemo').textContent).toContain('managed by the app')
  expect([...win().querySelectorAll('[data-tool]')].map((t) => t.getAttribute('data-tool'))).toEqual(['git', 'claude', 'mnemo', 'gh'])
})

test('a missing Claude Code installs in a terminal the drawer shows, from the home folder, and the window gives way', async () => {
  await render([row('git', '/usr/bin/git'), row('claude', null), row('mnemo', '/m'), row('gh', '/gh')])
  const route = installRoute('claude', osOf(navigator.platform))
  expect(tool('claude').textContent).toContain(route.shows)
  await act(async () => buttonIn(tool('claude'), 'Install Claude Code')!.click())
  await act(async () => new Promise((r) => setTimeout(r, 0)))
  expect(opened.specs).toEqual([{ kind: 'command', root: '/Users/me', command: route.command, label: 'Install Claude Code' }])
  expect(windowStore.getState().open).toBeNull()
})

test('git and gh install the same way, each by its own route', async () => {
  await render([row('git', null), row('claude', '/c'), row('mnemo', '/m'), row('gh', null)])
  const os = osOf(navigator.platform)
  await act(async () => buttonIn(tool('gh'), 'Install gh')!.click())
  await act(async () => new Promise((r) => setTimeout(r, 0)))
  expect(opened.specs).toEqual([{ kind: 'command', root: '/Users/me', command: installRoute('gh', os).command, label: 'Install gh' }])
  await act(async () => openWindow('setup'))
  await act(async () => new Promise((r) => setTimeout(r, 0)))
  await act(async () => buttonIn(tool('git'), 'Install git')!.click())
  await act(async () => new Promise((r) => setTimeout(r, 0)))
  expect(opened.specs[1]).toEqual({ kind: 'command', root: '/Users/me', command: installRoute('git', os).command, label: 'Install git' })
})

test('a terminal that cannot open says why, and the window stays', async () => {
  await render([row('git', '/g'), row('claude', null), row('mnemo', '/m'), row('gh', '/gh')])
  opened.refuse = 'no pty'
  await act(async () => buttonIn(tool('claude'), 'Install Claude Code')!.click())
  await act(async () => new Promise((r) => setTimeout(r, 0)))
  expect(windowStore.getState().open?.id).toBe('setup')
  expect(win().querySelector('[role="alert"]')!.textContent).toBe('Could not open a terminal: no pty')
})

test('mnemo installs inside the app, and the list is checked again after', async () => {
  await render([row('git', '/g'), row('claude', '/c'), row('mnemo', null), row('gh', '/gh')])
  tauri.answers.tools_install_mnemo = 'v1.2.0'
  tauri.answers.tools_status = [row('git', '/g'), row('claude', '/c'), row('mnemo', '/m', { managed: true, version: 'mnemo 1.2.0' }), row('gh', '/gh')]
  tauri.calls = []
  await act(async () => buttonIn(tool('mnemo'), 'Install mnemo')!.click())
  await act(async () => new Promise((r) => setTimeout(r, 0)))
  expect(tauri.calls).toEqual(['tools_install_mnemo', 'tools_status'])
  expect(tool('mnemo').textContent).toContain('mnemo v1.2.0 installed')
  expect(win().querySelector('.nx-su-summary')!.textContent).toBe('Everything is in place.')
  expect(opened.specs).toEqual([])
})

test('the mnemo the app installed is offered a newer release', async () => {
  tauri.answers.tools_mnemo_latest = 'v1.3.0'
  await render([row('git', '/g'), row('claude', '/c'), row('mnemo', '/m', { managed: true, version: 'mnemo 1.2.0' }), row('gh', '/gh')])
  await act(async () => new Promise((r) => setTimeout(r, 0)))
  expect(buttonIn(tool('mnemo'), 'Update to v1.3.0')).toBeDefined()
})

test('a check that fails says so; Add to PATH says what it did', async () => {
  tauri.answers.tools_add_to_path = 'Added to ~/.zprofile'
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  tauri.answers.tools_status = new Error('PATH unreadable')
  await act(async () => root.render(<WindowHost />))
  await act(async () => openWindow('setup'))
  await act(async () => new Promise((r) => setTimeout(r, 0)))
  unmount = () => act(async () => root.unmount())
  expect(win().querySelector('.nx-su-status')!.textContent).toBe('could not check the tools: PATH unreadable')
  await act(async () => buttonIn(win(), 'Add to PATH')!.click())
  await act(async () => new Promise((r) => setTimeout(r, 0)))
  expect(win().querySelector('.nx-su-ok')!.textContent).toBe('Added to ~/.zprofile')
})
