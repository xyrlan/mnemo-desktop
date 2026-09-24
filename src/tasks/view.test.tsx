import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'
import type { HomeSnapshot } from '../home/types'

/** Every `job_run` a dispatch asked for, and every `home_*` command the view sent. */
const ipc = vi.hoisted(() => ({ runs: [] as { cwd: string; argv: string[] }[], sent: [] as string[], snapshot: null as unknown }))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args?: unknown) => {
    ipc.sent.push(cmd)
    if (cmd === 'home_snapshot') return ipc.snapshot
    if (cmd === 'job_run') return void ipc.runs.push(args as never)
    return null
  },
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: async () => null }))
const composer = vi.hoisted(() => ({ calls: [] as unknown[] }))
vi.mock('./upstream', () => ({ openNewWorkspace: (opts?: unknown) => void composer.calls.push(opts) }))

import { paneView } from '../panes/registry'
import { all } from '../actions/registry'
import { store as appStore } from '../layout/app-store'
import { homeStore } from '../home/app-store'
import { missionStore } from '../mission/app-store'
import { selectionStore } from '../github/app-store'
import { cockpitStore } from '../cockpit/app-store'
import { issue, snapWithIssues } from '../github/fixtures'
import { EMPTY } from '../home/types'
import './view'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// The cockpit fixtures' mnemo repo: its child is on `fix/issue-40`, so #40 is already worked on.
const ROOT = '/Users/me/github/mnemo'
const home: HomeSnapshot = {
  ...EMPTY,
  repos: [
    {
      root: ROOT,
      name: 'mnemo',
      last_at: 0,
      pinned: false,
      hidden: false,
      unresolved: false,
      sessions: [],
      children: [],
      issues: [issue({ number: 1, title: 'first' }), issue({ number: 2, title: 'second', labels: ['ui'] }), issue({ number: 3, title: 'third' }), issue({ number: 40, title: 'dispatched issue' })],
      prs: [{ number: 13, title: 'docs', state: 'draft', checks: 'fail', child: null, url: 'https://github.com/me/mnemo/pull/13' }],
    },
    { root: '/Users/me/github/hidden', name: 'hidden', last_at: 0, pinned: false, hidden: true, unresolved: false, sessions: [], children: [], issues: [issue({ number: 9, title: 'never shown' })] },
  ],
}

let host: HTMLDivElement
let r: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  r = createRoot(host)
  ipc.runs = []
  ipc.sent = []
  ipc.snapshot = home
  composer.calls = []
  homeStore.setState({ snapshot: EMPTY, github: 'idle', githubAt: null, openedPr: null })
  missionStore.setState({ snapshot: snapWithIssues })
  selectionStore.getState().clearSelection()
  cockpitStore.setState({ drawer: null, jobs: {} })
})
afterEach(() => {
  act(() => r.unmount())
  host.remove()
})

async function settle() {
  for (let i = 0; i < 4; i++) await act(async () => void (await new Promise((res) => setTimeout(res, 0))))
}
async function render() {
  const View = paneView('tasks')!
  await act(async () => r.render(<View id={-1} props={{}} />))
  await settle()
}
const row = (n: number) => host.querySelector<HTMLElement>(`[data-issue="${n}"]`)
const button = (within: ParentNode, text: string) => [...within.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text)
const click = (el: Element | null | undefined, init: MouseEventInit = {}) => act(() => void el!.dispatchEvent(new MouseEvent('click', { bubbles: true, ...init })))

test('registers the tasks view and tasks.open, which opens one Tasks tab and then goes back to it', () => {
  expect(paneView('tasks')).toBeDefined()
  const a = all().find((x) => x.id === 'tasks.open')!
  expect(a).toBeDefined()
  const count = () => Object.values(appStore.getState().panes).filter((p) => p.view === 'tasks').length
  const before = count()
  act(() => void a.run())
  expect(count()).toBe(before + 1)
  const tasks = Object.values(appStore.getState().panes).find((p) => p.view === 'tasks')!
  act(() => void appStore.getState().newTab())
  act(() => void a.run())
  expect(count()).toBe(before + 1)
  const st = appStore.getState()
  expect(st.tabs.find((t) => t.id === st.activeTab)?.focused).toBe(tasks.id)
})

test('opening it reads Home, then GitHub, and lists each shown repo’s issues and PRs', async () => {
  await render()
  expect(ipc.sent).toContain('home_snapshot')
  expect(ipc.sent).toContain('home_refresh_github')
  expect([...host.querySelectorAll('[data-issue]')].map((e) => e.getAttribute('data-issue'))).toEqual(['1', '2', '3', '40'])
  expect(host.querySelector('[data-pr="13"]')?.textContent).toContain('docs')
  expect(host.querySelector('[data-pr="13"] [aria-label="checks fail"]')).not.toBeNull()
  expect(host.textContent).not.toContain('never shown')
  expect(host.textContent).toContain('4 issues · 1 PR')
})

test('the filter narrows the rows', async () => {
  await render()
  const input = host.querySelector<HTMLInputElement>('input[aria-label="filter issues and PRs"]')!
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    set.call(input, 'ui')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect([...host.querySelectorAll('[data-issue]')].map((e) => e.getAttribute('data-issue'))).toEqual(['2'])
  expect(host.querySelector('[data-pr]')).toBeNull()
})

test('New workspace opens the composer with the repo and the issue', async () => {
  await render()
  click(button(row(2)!, 'New workspace'))
  expect(composer.calls).toEqual([{ repo: ROOT, issue: { number: 2, title: 'second' } }])
})

test('Dispatch runs mnemo dispatch for that issue in its repo', async () => {
  await render()
  click(button(row(3)!, 'Dispatch'))
  await settle()
  expect(ipc.runs.map((x) => [x.cwd, x.argv])).toEqual([[ROOT, ['mnemo', 'dispatch', '3']]])
})

test('an issue something already works on shows it, and cannot be dispatched or picked', async () => {
  await render()
  expect(row(40)!.textContent).toContain('child')
  expect(button(row(40)!, 'Dispatch')).toBeUndefined()
  expect(row(40)!.querySelector('[role="checkbox"]')).toBeNull()
  expect(button(row(40)!, 'New workspace')).toBeDefined()
})

test('picked issues dispatch as one batch, with the flags chosen, and the pick clears', async () => {
  await render()
  click(row(3)!.querySelector('[role="checkbox"]'))
  click(row(1)!.querySelector('[role="checkbox"]'))
  expect(row(1)!.querySelector('[role="checkbox"]')?.getAttribute('aria-checked')).toBe('true')
  const bar = host.querySelector('[role="toolbar"]')!
  expect(bar.textContent).toContain('2 selected')
  click(button(bar, 'Dispatch 2'))
  const dialog = document.querySelector('[role="dialog"]')!
  expect(dialog.textContent).toContain('#1, #3')
  const model = dialog.querySelectorAll('select')[0]
  await act(async () => {
    model.value = 'sonnet'
    model.dispatchEvent(new Event('change', { bubbles: true }))
  })
  click(button(dialog, 'Dispatch'))
  await settle()
  expect(ipc.runs.map((x) => x.argv)).toEqual([['mnemo', 'dispatch', '1', '3', '--model', 'sonnet']])
  expect(selectionStore.getState().ns).toEqual([])
  expect(host.querySelector('[role="toolbar"]')).toBeNull()
})

test('shift-click picks the range, and a second click unpicks', async () => {
  await render()
  click(row(1)!.querySelector('[role="checkbox"]'))
  click(row(3)!.querySelector('[role="checkbox"]'), { shiftKey: true })
  expect(selectionStore.getState().ns).toEqual([1, 2, 3])
  click(row(2)!.querySelector('[role="checkbox"]'))
  expect(selectionStore.getState().ns).toEqual([1, 3])
})

test('a PR opens the PR view over the list, and closing it goes back', async () => {
  await render()
  click(host.querySelector('[data-pr="13"] button[title="open the PR view"]'))
  await settle()
  expect(homeStore.getState().openedPr).toMatchObject({ repo: ROOT, pr: { number: 13 } })
  expect(host.querySelector('.hm-pr-view')?.textContent).toContain('PR #13')
  click(host.querySelector('.hm-pr-back'))
  expect(host.querySelector('.hm-pr-view')).toBeNull()
})

test('a PR Home opened is not drawn a second time by Tasks', async () => {
  await render()
  act(() => homeStore.getState().openPr(ROOT, home.repos[0].prs![0]))
  expect(host.querySelector('.hm-pr-view')).toBeNull()
})

test('with no project yet, it says where to add one', async () => {
  ipc.snapshot = EMPTY
  await render()
  expect(host.textContent).toContain('No projects yet')
})
