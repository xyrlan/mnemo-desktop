import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'

/** What the GitHub commands answer (issues for the `mnemo` repo only); everything else gets `{}`. */
const gh: { auth: unknown; issues: unknown } = { auth: {}, issues: [] }
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string, args?: { root?: string }) =>
    cmd === 'gh_auth' ? gh.auth : cmd === 'gh_issues' ? (args?.root === '/Users/me/github/mnemo' ? gh.issues : []) : {},
  ),
}))

import { missionStore } from '../mission/app-store'
import { store as appStore } from '../layout/app-store'
import { settingsStore } from '../settings/app-store'
import { paneView } from '../panes/registry'
import { all } from '../actions/registry'
import { withPrs } from './fixtures'
import { githubStore } from '../github/app-store'
import { mnemoIssues, snapWithIssues } from '../github/fixtures'
import './view'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// React Flow measures with ResizeObserver, which jsdom lacks.
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = RO

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  missionStore.setState({ snapshot: withPrs, lastError: null, looked: {}, drafts: {}, sent: {} })
  settingsStore.setState({ sidebarScope: 'all', issueLabels: {} })
  gh.auth = {}
  gh.issues = []
  githubStore.setState({ auth: null, issues: {}, boards: {} })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function render() {
  const View = paneView('cockpit')!
  act(() => root.render(<View id={-1} props={{}} />))
}

const node = (id: string) => [...host.querySelectorAll<HTMLElement>('.react-flow__node')].find((n) => n.dataset.id === id) ?? null

test('registers the cockpit view and the cockpit.open action', () => {
  expect(paneView('cockpit')).toBeDefined()
  expect(all().find((a) => a.id === 'cockpit.open')?.shortcut).toBe('⌘⇧B')
})

test('renders the canvas: repo, parent, mission group, children, PR and CI nodes', () => {
  render()
  expect(host.querySelector('.ck-head')?.textContent).toContain('3 repos')
  expect(node('repo:/Users/me/github/mnemo-desktop')?.textContent).toContain('mnemo-desktop')
  expect(node('parent:0ff9d810-aaaa')?.textContent).toContain('round3 dispatch')
  expect(node('child:094c6a03')?.querySelector('.gr-card')?.className).toContain('gr-pulse')
  expect(node('pr:/Users/me/github/mnemo#13')?.querySelector('.gr-bad')).not.toBeNull()
  expect(node('ci:/Users/me/github/mnemo#12')).not.toBeNull()
  expect(host.querySelectorAll('.react-flow__node-group').length).toBe(2)
})

test('the needs-you strip lists blocked, red CI and landable, and opens them', () => {
  render()
  const chips = [...host.querySelectorAll<HTMLButtonElement>('.ck-strip .nd')]
  expect(chips.map((c) => c.className.split(' ')[1])).toEqual(['nd-blocked', 'nd-ci', 'nd-land'])
  expect(chips[0].textContent).toContain('vault')
  act(() => chips[0].click())
  expect(Object.values(appStore.getState().panes).find((p) => p.view === 'mission')?.props).toEqual({ id: '094c6a03' })
})

test('click a child opens its mission pane; double-click attaches; click a PR opens it', () => {
  render()
  act(() => node('child:a43d3832')!.click())
  expect(Object.values(appStore.getState().panes).some((p) => p.view === 'mission' && p.props?.id === 'a43d3832')).toBe(true)
  act(() => node('child:a43d3832')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
  expect(Object.values(appStore.getState().panes).some((p) => p.view === 'terminal-cmd' && p.props?.cmd === 'claude attach a43d3832')).toBe(true)
  act(() => node('pr:/Users/me/github/mnemo#13')!.click())
  expect(Object.values(appStore.getState().panes).some((p) => p.view === 'browser' && p.props?.url === 'https://github.com/me/mnemo/pull/13')).toBe(true)
})

test('"this repo" narrows the canvas to the focused repo', async () => {
  settingsStore.setState({ sidebarScope: 'repo' })
  await act(async () => {
    await appStore.getState().newTab()
  })
  const tab = appStore.getState().tabs.at(-1)!
  act(() => appStore.getState().setCwd(tab.focused, '/Users/me/github/mnemo-issue-40'))
  render()
  expect(node('repo:/Users/me/github/mnemo')?.querySelector('.gr-accent')).not.toBeNull()
  expect(node('repo:/Users/me/github/mnemo-desktop')).toBeNull()
  expect(host.querySelector('.ck-strip')?.textContent).not.toContain('vault')
})

test('shows the empty state and errors', () => {
  missionStore.setState({ snapshot: { repos: [], errors: ['gh missing on PATH'], at: '' }, lastError: null })
  render()
  expect(host.textContent).toContain('no live sessions')
  expect(host.textContent).toContain('gh missing on PATH')
  expect(host.querySelector('.ck-strip')?.textContent).toContain('nothing')
})

test('logged in: issue roots on the canvas, a label picker in the strip, click an issue to dispatch it', async () => {
  const root = '/Users/me/github/mnemo'
  gh.auth = { installed: true, logged: true, login: 'me', scopes: [] }
  gh.issues = mnemoIssues
  missionStore.setState({ snapshot: snapWithIssues })
  const typed: [string | undefined, string][] = []
  appStore.setState({ openCommandTab: async (cwd, cmd) => void typed.push([cwd, cmd]) })
  render()
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })

  expect(node(`issue:${root}#40`)?.textContent).toContain('#40 dispatched issue')
  expect(node(`issue:${root}#12`)).not.toBeNull()
  expect(node(`issue:${root}#1`)).toBeNull()

  // One picker per repo with issues; only mnemo has any, so it carries no repo name.
  const chip = host.querySelector<HTMLButtonElement>('.ck-strip .gh-picker-chip')!
  expect(chip.textContent).toContain('all labels')
  act(() => chip.click())
  const bug = [...host.querySelectorAll<HTMLLabelElement>('.gh-picker-menu label')].find((l) => l.textContent === 'bug')!
  await act(async () => bug.querySelector('input')!.click())
  expect(settingsStore.getState().issueLabels).toEqual({ [root]: ['bug'] })
  expect(node(`issue:${root}#12`)).toBeNull()
  expect(node(`issue:${root}#1`)).not.toBeNull()

  act(() => node(`issue:${root}#1`)!.click())
  expect(host.querySelector('.ck-issue-bar')?.textContent).toContain('#1 issue 1')
  act(() => [...host.querySelectorAll<HTMLButtonElement>('.ck-issue-bar button')].find((b) => b.textContent === 'dispatch')!.click())
  expect(typed).toEqual([[root, 'mnemo dispatch 1']])
  act(() => node(`issue:${root}#1`)!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
  expect(Object.values(appStore.getState().panes).some((p) => p.view === 'browser' && p.props?.url === 'https://github.com/me/mnemo/issues/1')).toBe(true)
})

test('not logged in: no issues are fetched and the strip has no picker', async () => {
  gh.auth = { installed: true, logged: false, login: null, scopes: [] }
  gh.issues = mnemoIssues
  render()
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
  expect(githubStore.getState().issues).toEqual({})
  expect(host.querySelector('.gh-picker')).toBeNull()
})
