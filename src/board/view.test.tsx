import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'

const root = '/Users/me/github/mnemo'
/** What the GitHub commands answer; `project` rejects when it is a string. */
const gh: { auth: unknown; project: unknown; issues: unknown } = { auth: {}, project: null, issues: [] }
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === 'gh_auth') return gh.auth
    if (cmd === 'gh_issues') return gh.issues
    if (cmd === 'gh_project') return typeof gh.project === 'string' ? Promise.reject(gh.project) : gh.project
    return {}
  }),
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null) }))

import { paneView } from '../panes/registry'
import { all } from '../actions/registry'
import { store as appStore } from '../layout/app-store'
import { missionStore } from '../mission/app-store'
import { homeStore } from '../home/app-store'
import { settingsStore } from '../settings/app-store'
import { githubStore } from '../github/app-store'
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
  gh.auth = logged
  gh.project = board
  gh.issues = mnemoIssues
  missionStore.setState({ snapshot: snapWithIssues })
  homeStore.setState({ selected: root })
  settingsStore.setState({ issueLabels: {} })
  githubStore.setState({ auth: null, issues: {}, boards: {} })
  appStore.setState({ openCommandTab: async (cwd, cmd) => void typed.push([cwd, cmd]) })
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

  // An issue nobody works on can be dispatched from its card.
  act(() => cards[0].querySelector<HTMLButtonElement>('.bd-dispatch')!.click())
  expect(typed).toEqual([[root, 'mnemo dispatch 1']])
  act(() => cards[0].click())
  expect(Object.values(appStore.getState().panes).some((p) => p.view === 'browser' && p.props?.url === 'https://github.com/me/mnemo/issues/1')).toBe(true)
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
  expect(host.querySelector('.bd-notice')?.textContent).toContain('rodar gh auth refresh -s project')
  act(() => buttons('rodar')[0].click())
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
  act(() => buttons('Entrar no GitHub')[0].click())
  expect(typed).toEqual([[undefined, 'gh auth login --web']])
  expect(githubStore.getState().boards).toEqual({})
})
