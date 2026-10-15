import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'
import type { HomeSnapshot } from '../../../home/types'

/** Every `job_run` a dispatch asked for, every page sent to the browser, every command sent, and
 *  what `fs_list` finds in a folder. */
const ipc = vi.hoisted(() => ({
  runs: [] as { cwd: string; argv: string[] }[],
  opened: [] as string[],
  sent: [] as string[],
  snapshot: null as unknown,
  dirs: {} as Record<string, string[]>,
}))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args?: Record<string, unknown>) => {
    ipc.sent.push(cmd)
    if (cmd === 'home_snapshot') return ipc.snapshot
    if (cmd === 'job_run') return void ipc.runs.push(args as never)
    if (cmd === 'browser_open_external') return void ipc.opened.push(String(args?.url))
    if (cmd === 'fs_list') {
      const names = ipc.dirs[String(args?.dir)]
      if (!names) throw new Error('No such file or directory (os error 2)')
      return names.map((name) => ({ name, is_dir: false }))
    }
    return null
  },
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))

import { cockpitStore } from '../../../cockpit/app-store'
import { shipped } from '../../../cockpit/fixtures'
import { issue, snapWithIssues } from '../../../github/fixtures'
import { homeStore } from '../../../home/app-store'
import { EMPTY } from '../../../home/types'
import { missionStore } from '../../../mission/app-store'
import { ConfirmHost } from '../../ui/confirm'
import { WindowHost } from '../../ui/Window'
import { closeWindow, openWindow, windowDef, windowStore } from '../../ui/windows'
import './index'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// The cockpit fixtures' mnemo repo: its child `c0ffee01` is on `fix/issue-40`, so #40 is in flight.
const ROOT = '/Users/me/github/mnemo'
const NOTES = '/Users/me/notes'
const repo = (root: string, name: string, over: Partial<HomeSnapshot['repos'][number]> = {}): HomeSnapshot['repos'][number] => ({
  root, name, last_at: 0, pinned: false, hidden: false, unresolved: false, sessions: [], children: [], ...over,
})
const home: HomeSnapshot = {
  ...EMPTY,
  repos: [
    repo(ROOT, 'mnemo', {
      issues: [issue({ number: 1, title: 'first' }), issue({ number: 2, title: 'second', labels: ['ui'] }), issue({ number: 3, title: 'third' }), issue({ number: 40, title: 'dispatched issue' })],
      prs: [
        { number: 13, title: 'docs', state: 'draft', checks: 'fail', child: null, url: 'https://github.com/me/mnemo/pull/13' },
        { number: 12, title: 'api', state: 'open', checks: 'pass', child: 'c0ffee01', url: 'https://github.com/me/mnemo/pull/12' },
      ],
    }),
    repo(NOTES, 'notes', { issues: [issue({ number: 7, title: 'notes issue', url: 'https://github.com/me/notes/issues/7' })] }),
    repo('/Users/me/github/hidden', 'hidden', { hidden: true, issues: [issue({ number: 9, title: 'never shown' })] }),
  ],
}

let host: HTMLDivElement
let r: Root

beforeEach(() => {
  host = document.body.appendChild(document.createElement('div'))
  r = createRoot(host)
  Object.assign(ipc, { runs: [], opened: [], sent: [], snapshot: home, dirs: {} })
  homeStore.setState({ snapshot: EMPTY, github: 'idle', githubAt: null, openedPr: null })
  missionStore.setState({ snapshot: snapWithIssues })
  cockpitStore.setState({ drawer: null, jobs: {} })
})
afterEach(() => {
  act(() => r.unmount())
  closeWindow()
  document.body.innerHTML = ''
})

async function settle() {
  for (let i = 0; i < 4; i++) await act(async () => void (await new Promise((res) => setTimeout(res, 0))))
}
/** The robots the ship draws, and the ones a window opened in the drawer (the Nexus's `onOpen`). */
const figures = { onShip: new Set<string>(), opened: [] as string[] }
const openFigure = (id: string) => figures.onShip.has(id) && figures.opened.push(id) > 0
async function open(params: Record<string, unknown> = {}) {
  await act(async () =>
    r.render(
      <>
        <WindowHost open={openFigure} />
        <ConfirmHost />
      </>,
    ),
  )
  act(() => openWindow('missions', params))
  await settle()
}
const row = (n: number) => document.querySelector<HTMLElement>(`[data-issue="${n}"]`)
const pr = (n: number) => document.querySelector<HTMLElement>(`[data-pr="${n}"]`)
const button = (within: ParentNode, text: string) => [...within.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text)
const click = (el: Element | null | undefined, init: MouseEventInit = {}) => act(() => void el!.dispatchEvent(new MouseEvent('click', { bubbles: true, ...init })))
const shown = () => [...document.querySelectorAll('[data-issue]')].map((e) => Number(e.getAttribute('data-issue')))
async function choose(select: HTMLSelectElement, value: string) {
  await act(async () => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

test('MISSIONS is registered as a window, and opening it reads Home, then GitHub', async () => {
  expect(windowDef('missions')?.title).toBe('Missions')
  await open()
  expect(document.querySelector('[role="dialog"][aria-label="Missions"]')).not.toBeNull()
  expect(ipc.sent).toContain('home_snapshot')
  expect(ipc.sent).toContain('home_refresh_github')
})

test('it lists every shown repo’s open issues and PRs, never a hidden repo’s', async () => {
  await open()
  expect(shown()).toEqual([1, 2, 3, 40, 7])
  expect(pr(13)!.textContent).toContain('docs')
  expect(pr(13)!.textContent).toContain('draft')
  expect(document.body.textContent).not.toContain('never shown')
})

test('root opens it on that repo, and the repo picker shows every repo again', async () => {
  await open({ root: `${NOTES}/` })
  expect(shown()).toEqual([7])
  await choose(document.querySelector<HTMLSelectElement>('select[aria-label="repo"]')!, '')
  expect(shown()).toEqual([1, 2, 3, 40, 7])
})

test('the filter narrows the rows', async () => {
  await open()
  await type(document.querySelector<HTMLInputElement>('input[aria-label="filter issues and PRs"]')!, 'ui')
  expect(shown()).toEqual([2])
  expect(pr(13)).toBeNull()
})

test('a PR shows its checks, and opens in the system browser', async () => {
  await open()
  expect(pr(13)!.querySelector('[aria-label="checks fail"]')).not.toBeNull()
  expect(pr(12)!.querySelector('[aria-label="checks pass"]')).not.toBeNull()
  click(pr(13)!.querySelector('[aria-label="Open PR #13 in the browser"]'))
  click(row(2)!.querySelector('.nx-mis-title'))
  await settle()
  expect(ipc.opened).toEqual(['https://github.com/me/mnemo/pull/13', 'https://github.com/me/mnemo/issues/2'])
  expect(ipc.sent).not.toContain('browser_create')
})

test('an issue in flight says so and cannot be picked or dispatched', async () => {
  await open()
  expect(row(40)!.textContent).toContain('child')
  expect(row(40)!.querySelector('[role="checkbox"]')).toBeNull()
  expect(button(row(40)!, 'Dispatch')).toBeUndefined()
})

test('an issue in flight links to its robot: it opens in the drawer, also where the ship draws no figure of it, and the window closes', async () => {
  figures.onShip = new Set(['c0ffee01'])
  figures.opened = []
  await open()
  expect(document.querySelector('[data-ship-id]')).toBeNull()
  click(button(row(40)!, 'robot c0ffee01 →'))
  await settle()
  expect(windowStore.getState().open).toBeNull()
  expect(figures.opened).toEqual(['c0ffee01'])
})

test('a robot the ship does not have says so, and the window stays', async () => {
  figures.onShip = new Set()
  await open()
  click(button(pr(12)!, 'robot c0ffee01 →'))
  await settle()
  expect(windowStore.getState().open?.id).toBe('missions')
  expect(document.querySelector('[role="status"]')!.textContent).toContain('Robot c0ffee01 is not on the ship now.')
})

test('picked issues dispatch as one batch with the flags chosen; the pick clears and the job shows', async () => {
  await open()
  click(row(3)!.querySelector('[role="checkbox"]'))
  click(row(1)!.querySelector('[role="checkbox"]'))
  expect(row(1)!.querySelector('[role="checkbox"]')!.getAttribute('aria-checked')).toBe('true')
  const bar = document.querySelector('[role="toolbar"]')!
  expect(bar.textContent).toContain('#1, #3')
  await choose(bar.querySelector<HTMLSelectElement>('select[aria-label="Model"]')!, 'sonnet')
  await choose(bar.querySelector<HTMLSelectElement>('select[aria-label="Effort"]')!, 'high')
  await choose(bar.querySelector<HTMLSelectElement>('select[aria-label="May"]')!, 'pr')
  click(button(bar, 'Dispatch 2'))
  await settle()
  expect(ipc.runs.map((x) => [x.cwd, x.argv])).toEqual([[ROOT, ['mnemo', 'dispatch', '1', '3', '--model', 'sonnet', '--effort', 'high', '--may', 'pr']]])
  expect(document.querySelector('[role="toolbar"]')).toBeNull()
  expect(document.querySelector('[data-job]')!.textContent).toContain('dispatch · #1, #3')
})

test('Dispatch on a row picks only it; shift-click extends the pick; a pick in another repo starts over', async () => {
  await open()
  click(button(row(2)!, 'Dispatch'))
  expect(document.querySelector('[role="toolbar"]')!.textContent).toContain('#2 in mnemo')
  click(row(1)!.querySelector('[role="checkbox"]'))
  click(row(3)!.querySelector('[role="checkbox"]'), { shiftKey: true })
  expect(document.querySelector('[role="toolbar"]')!.textContent).toContain('#1, #2, #3 in mnemo')
  click(row(7)!.querySelector('[role="checkbox"]'))
  expect(document.querySelector('[role="toolbar"]')!.textContent).toContain('#7 in notes')
})

test('a dispatch already running cannot be started twice', async () => {
  cockpitStore.setState({ jobs: { [`dispatch:${ROOT}#2`]: { title: 'dispatch · #2', lines: [], running: true, code: null } } })
  await open()
  click(button(row(2)!, 'Dispatch'))
  expect(button(document.querySelector('[role="toolbar"]')!, 'Dispatch 1')!.disabled).toBe(true)
})

test('Dispatch contract lists the repo’s contracts and dispatches the chosen one with the flags', async () => {
  ipc.dirs[`${ROOT}/docs/superpowers/contracts`] = ['2026-10-01-old.md', '2026-10-15-new.md', 'notes.txt']
  await open({ root: ROOT })
  click(button(document.querySelector(`[data-root="${ROOT}"]`)!, 'Dispatch contract…'))
  await settle()
  const panel = document.querySelector<HTMLElement>('[data-contract-panel]')!
  const files = [...panel.querySelectorAll('[role="radio"] .nx-mis-text')].map((b) => b.textContent)
  expect(files).toEqual(['docs/superpowers/contracts/2026-10-15-new.md', 'docs/superpowers/contracts/2026-10-01-old.md'])
  expect(panel.querySelector('[role="radio"]')!.getAttribute('aria-checked')).toBe('true')
  await choose(panel.querySelector<HTMLSelectElement>('select[aria-label="Effort"]')!, 'max')
  click(button(panel, 'Dispatch contract'))
  await settle()
  expect(ipc.runs.map((x) => [x.cwd, x.argv])).toEqual([[ROOT, ['mnemo', 'dispatch', '--contract', 'docs/superpowers/contracts/2026-10-15-new.md', '--effort', 'max']]])
  expect(document.querySelector('[data-contract-panel]')).toBeNull()
})

test('a contract already dispatched is marked, and dispatching it again asks first', async () => {
  // `shipped`'s mission came from docs/contracts/round4.md.
  ipc.dirs[`${ROOT}/docs/contracts`] = ['round4.md']
  expect(shipped.missions[0].contract_path).toBe(`${ROOT}/docs/contracts/round4.md`)
  await open({ root: ROOT })
  click(button(document.querySelector(`[data-root="${ROOT}"]`)!, 'Dispatch contract…'))
  await settle()
  const panel = document.querySelector<HTMLElement>('[data-contract-panel]')!
  expect(panel.textContent).toContain('dispatched · 3 pieces')
  click(panel.querySelector('[role="radio"]'))
  click(button(panel, 'Dispatch contract'))
  await settle()
  const ask = document.querySelector<HTMLElement>('[data-nx-confirm]')!
  expect(ask.textContent).toContain('round4')
  click(button(ask, 'Cancel'))
  await settle()
  expect(ipc.runs).toEqual([])
  click(button(panel, 'Dispatch contract'))
  await settle()
  click(button(document.querySelector('[data-nx-confirm]')!, 'Dispatch again'))
  await settle()
  expect(ipc.runs.map((x) => x.argv)).toEqual([['mnemo', 'dispatch', '--contract', 'docs/contracts/round4.md']])
})

test('a typed contract path outside the repo is refused before anything runs', async () => {
  await open({ root: ROOT })
  click(button(document.querySelector(`[data-root="${ROOT}"]`)!, 'Dispatch contract…'))
  await settle()
  const panel = document.querySelector<HTMLElement>('[data-contract-panel]')!
  expect(panel.textContent).toContain('No contract in')
  await type(panel.querySelector<HTMLInputElement>('input[aria-label="contract path in the repo"]')!, '../other/plan.md')
  expect(button(panel, 'Dispatch contract')!.disabled).toBe(true)
  expect(panel.textContent).toContain('inside the repo')
})

test('with no project yet, it says where to add one', async () => {
  ipc.snapshot = EMPTY
  await open()
  expect(document.body.textContent).toContain('No projects yet. Add one from PROJECTS')
})
