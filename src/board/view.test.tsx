import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'

const root = '/Users/me/github/mnemo'
/** What the GitHub commands answer; `project` rejects when it is a string. */
const gh: { auth: unknown; project: unknown; issues: unknown } = { auth: {}, project: null, issues: [] }
/** Every `job_run` a dispatch or a resume asked for, and what `job.rs` would emit back. */
const jobs = vi.hoisted(() => ({ runs: [] as { id: string; cwd: string; argv: string[] }[], on: {} as Record<string, (e: { payload: unknown }) => void> }))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string, args?: unknown) => {
    if (cmd === 'gh_auth') return gh.auth
    if (cmd === 'gh_issues') return gh.issues
    if (cmd === 'gh_project') return typeof gh.project === 'string' ? Promise.reject(gh.project) : gh.project
    if (cmd === 'job_run') return void jobs.runs.push(args as never)
    return {}
  }),
}))
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (name: string, h: (e: { payload: unknown }) => void) => {
    jobs.on[name] = h
    return () => {}
  },
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null) }))

import { paneView } from '../panes/registry'
import { all } from '../actions/registry'
import { store as appStore } from '../layout/app-store'
import { missionStore } from '../mission/app-store'
import { homeStore } from '../home/app-store'
import { settingsStore } from '../settings/app-store'
import { githubStore, selectionStore } from '../github/app-store'
import { cockpitStore } from '../cockpit/app-store'
import { dispatchKey } from '../github/actions'
import { board, mnemoIssues, snapWithIssues } from '../github/fixtures'
import './view'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const logged = { installed: true, logged: true, login: 'me', scopes: ['repo'] }
let host: HTMLDivElement
let r: Root
const typed: [string | undefined, string][] = []

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  r = createRoot(host)
  typed.length = 0
  jobs.runs = []
  gh.auth = logged
  gh.project = board
  gh.issues = mnemoIssues
  missionStore.setState({ snapshot: snapWithIssues })
  homeStore.setState({ selected: root })
  settingsStore.setState({ issueLabels: {} })
  githubStore.setState({ auth: null, issues: {}, boards: {} })
  appStore.setState({ openCommandTab: async (cwd, cmd) => void typed.push([cwd, cmd]) })
  cockpitStore.setState({ drawer: null, jobs: {} })
})
afterEach(() => {
  act(() => r.unmount())
  host.remove()
})

async function render() {
  const View = paneView('board')!
  await act(async () => r.render(<View id={-1} props={{}} />))
  for (let i = 0; i < 3; i++) await act(async () => void (await new Promise((res) => setTimeout(res, 0))))
}
const buttons = (text: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].filter((b) => b.textContent === text)

test('registers the board view and board.open, which opens a board pane', () => {
  expect(paneView('board')).toBeDefined()
  const a = all().find((x) => x.id === 'board.open')!
  expect(a).toBeDefined()
  act(() => void a.run())
  expect(Object.values(appStore.getState().panes).some((p) => p.view === 'board')).toBe(true)
})

test('a linked Project renders as a kanban with the snapshot state on its cards', async () => {
  await render()
  expect(host.querySelector('.bd-head')?.textContent).toContain('mnemo')
  expect([...host.querySelectorAll('.bd-column header')].map((h) => h.textContent)).toEqual(['Todo 1', 'In Progress 2', 'Done 1'])
  const cards = [...host.querySelectorAll<HTMLElement>('.bd-card')]
  expect(cards[1].textContent).toContain('#40dispatched issue')
  expect(cards[1].querySelector('.bd-chip')?.textContent).toBe('child active')
  expect(cards[1].querySelector('.bd-dispatch')).toBeNull()
  expect(cards[2].querySelector('.bd-chip')?.textContent).toBe('PR open · CI ✗')
  expect(cards[3].className).toContain('bd-draft')

  // An issue nobody works on can be dispatched from its card: headless, not a terminal tab,
  // and its drawer opens right where the click happened.
  act(() => cards[0].querySelector<HTMLButtonElement>('.bd-dispatch')!.click())
  await act(async () => void (await new Promise((res) => setTimeout(res, 0))))
  expect(typed).toEqual([])
  expect(jobs.runs).toEqual([{ id: dispatchKey(root, [1]), cwd: root, argv: ['mnemo', 'dispatch', '1'] }])
  expect(host.querySelector('.ck-drawer')?.getAttribute('aria-label')).toBe('dispatch · #1')
  act(() => cards[0].click())
  expect(Object.values(appStore.getState().panes).some((p) => p.view === 'browser' && p.props?.url === 'https://github.com/me/mnemo/issues/1')).toBe(true)
})

test('dispatch streams output into the drawer, and a refusal still shows there', async () => {
  await render()
  const rows = [...host.querySelectorAll('.bd-row, .bd-card')].map((x) => x.querySelector<HTMLButtonElement>('.bd-dispatch')).filter((b): b is HTMLButtonElement => !!b)
  act(() => rows[0].click())
  await act(async () => void (await new Promise((res) => setTimeout(res, 0))))
  const id = jobs.runs[0].id
  act(() => jobs.on['job-line']({ payload: { id, stream: 'out', line: 'child abc123 on feat/x/1' } }))
  act(() => jobs.on['job-line']({ payload: { id, stream: 'out', line: 'attach: claude --resume abc123' } }))
  act(() => jobs.on['job-exit']({ payload: { id, code: 0 } }))
  const drawer = host.querySelector('.ck-drawer')!
  expect([...drawer.querySelectorAll('.ck-log-text')].map((l) => l.textContent)).toEqual(['child abc123 on feat/x/1', 'attach: claude --resume abc123'])
  // Dispatch is not silent on success: the drawer we opened stays, unlike a merge's.
  expect(drawer.querySelector('.ck-log-end')?.textContent).toBe('exit 0')
})

test('resume wakes this repo\'s stalled children headless, and dispatching a contract sends the typed path', async () => {
  await render()
  act(() => buttons('resume')[0].click())
  await act(async () => void (await new Promise((res) => setTimeout(res, 0))))
  expect(jobs.runs).toEqual([{ id: `resume:${root}`, cwd: root, argv: ['mnemo', 'resume'] }])

  act(() => buttons('dispatch contract')[0].click())
  const sheet = host.querySelector('.bd-sheet')!
  const input = sheet.querySelector('input')!
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'docs/contracts/round18.md')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  act(() => [...sheet.querySelectorAll('button')].find((b) => b.textContent === 'dispatch')!.click())
  await act(async () => void (await new Promise((res) => setTimeout(res, 0))))
  expect(jobs.runs[1]).toEqual({ id: `dispatch:${root}#contract:docs/contracts/round18.md`, cwd: root, argv: ['mnemo', 'dispatch', '--contract', 'docs/contracts/round18.md'] })
  expect(host.querySelector('.bd-sheet')).toBeNull()
})

test('without a Project: the open issues as a list, with the label filter', async () => {
  gh.project = null
  settingsStore.setState({ issueLabels: { [root]: ['ui'] } })
  await render()
  expect(host.textContent).toContain('no GitHub Project linked')
  const rows = [...host.querySelectorAll('.bd-row')]
  expect(rows.map((x) => x.querySelector('.bd-num')?.textContent)).toEqual(['#2', '#4', '#6', '#8', '#10', '#12'])
  expect(host.querySelector('.gh-picker-chip')?.textContent).toContain('ui')
})

test('needs_scope: says how to add the scope and still lists the issues', async () => {
  gh.project = 'needs_scope'
  await render()
  expect(host.querySelector('.bd-notice')?.textContent).toContain('run gh auth refresh -s project')
  act(() => buttons('run')[0].click())
  expect(typed).toEqual([[undefined, 'gh auth refresh -s project']])
  expect(host.querySelectorAll('.bd-row').length).toBe(mnemoIssues.length)
  // #40 already has a child: no dispatch button on its row.
  const row40 = [...host.querySelectorAll('.bd-row')].find((x) => x.querySelector('.bd-num')?.textContent === '#40')!
  expect(row40.querySelector('.bd-dispatch')).toBeNull()
})

test('gh missing or logged out: offers the fix instead of a board', async () => {
  gh.auth = { installed: false, logged: false, login: null, scopes: [] }
  await render()
  expect(buttons('brew install gh')).toHaveLength(1)
  act(() => r.unmount())
  r = createRoot(host)
  githubStore.setState({ auth: null })
  gh.auth = { installed: true, logged: false, login: null, scopes: [] }
  await render()
  act(() => buttons('Log in to GitHub')[0].click())
  expect(typed).toEqual([[undefined, 'gh auth login --web']])
  expect(githubStore.getState().boards).toEqual({})
})

test('the dispatch sheet offers closed sets, never free text', async () => {
  gh.project = null
  await render()
  const rows = [...host.querySelectorAll('.bd-row')].filter((x) => x.querySelector('.bd-dispatch'))
  expect(rows.length).toBeGreaterThan(0)
  const n = Number(rows[0].querySelector('.bd-num')!.textContent!.slice(1))
  act(() => selectionStore.getState().pick(root, [n], n, { shift: false, meta: false }))
  await act(async () => void (await new Promise((res) => setTimeout(res, 0))))
  act(() => buttons('dispatch selected')[0].click())

  const sheet = host.querySelector('.bd-sheet')!
  expect(sheet).toBeTruthy()
  // The flag values are joined into a command typed into a shell, so none of them may be typed.
  expect(sheet.querySelectorAll('input')).toHaveLength(0)
  const opts = (i: number) => [...sheet.querySelectorAll('select')[i].options].map((o) => o.value)
  expect(opts(0)).toEqual(['', 'haiku', 'sonnet', 'opus'])
  expect(opts(1)).toEqual(['', 'low', 'medium', 'high', 'xhigh', 'max'])
  expect(opts(2)).toEqual(['', 'pr', 'push', 'none'])
})
