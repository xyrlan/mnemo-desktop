import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { setup } from '../../../setup/app-store'
import { IDLE_RUN, NOT_ASKED } from '../../../setup/store'
import { installRoute, osOf, type ToolStatus } from '../../../setup/tools'
import { WindowHost } from '../../ui/Window'
import { closeWindow, openWindow } from '../../ui/windows'
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

test('with only Grok accounts in use, grok is needed and claude is not; grok installs in a terminal', async () => {
  await render([
    row('git', '/g'),
    row('claude', null, { needed: false }),
    row('grok', null, { needed: true }),
    row('mnemo', '/m', { needed: true }),
    row('gh', '/gh'),
  ])
  expect([...win().querySelectorAll('[data-tool]')].map((t) => t.getAttribute('data-tool'))).toEqual(['git', 'claude', 'grok', 'mnemo', 'gh'])
  expect(tool('grok').dataset.state).toBe('needed')
  expect(tool('claude').dataset.state).toBe('missing')
  expect(win().querySelector('.nx-su-summary')!.textContent).toBe('grok and mnemo are both needed. Install what is missing, one click each.')
  const route = installRoute('grok', osOf(navigator.platform))
  expect(tool('grok').textContent).toContain(route.shows)
  await act(async () => buttonIn(tool('grok'), 'Install Grok Build')!.click())
  expect(opened.specs).toEqual([{ kind: 'command', root: '/Users/me', command: route.command, label: 'Install Grok Build' }])
})

test('with both kinds in use, the summary names all three; once they are found, it says so', async () => {
  await render([row('git', null), row('claude', '/c', { needed: true }), row('grok', '/k', { needed: true }), row('mnemo', '/m', { needed: true }), row('gh', '/gh')])
  expect(win().querySelector('.nx-su-summary')!.textContent).toBe('claude, grok and mnemo are in place.')
})
