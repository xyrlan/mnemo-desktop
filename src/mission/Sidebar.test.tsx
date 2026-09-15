import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'
import { snapshot } from './fixtures'
import { withPrs } from '../cockpit/fixtures'
import type { Snapshot } from './types'

// The sidebar polls on mount; it gets whatever snapshot the test serves.
const served = vi.hoisted(() => ({ snap: null as unknown, home: null as unknown }))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string) => (cmd === 'mission_snapshot' ? served.snap : cmd === 'home_snapshot' ? served.home : {})),
}))

import Sidebar from './Sidebar'
import { missionStore } from './app-store'
import { store as appStore } from '../layout/app-store'
import { homeStore } from '../home/app-store'
import type { ChromeClient } from '../chrome/client'
import type { HomeSnapshot } from '../home/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(async () => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  serve(snapshot)
  const home: HomeSnapshot = { repos: [], clone_base: '', errors: [], protected: 0 }
  served.home = home
  homeStore.setState({ snapshot: home, loading: false })
  appStore.setState({ tabs: [], activeTab: '', panes: {} })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function serve(snap: Snapshot) {
  served.snap = snap
  missionStore.setState({ snapshot: snap, lastError: null, sidebarOpen: true, drafts: {}, sent: {} })
}

const chrome: ChromeClient = {
  repo: async (cwd) => (cwd.startsWith('/Users/me/github/mnemo-desktop') ? 'mnemo-desktop' : null),
  branch: async (cwd) => (cwd.startsWith('/Users/me/github/mnemo-desktop') ? 'main' : null),
}

async function render() {
  await act(async () => root.render(<Sidebar chrome={chrome} />))
  // Let the git answers for the tab rows land.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

const needs = () => [...host.querySelectorAll('.needs-list .nd-label')].map((e) => e.textContent)

test('needs you lists every repo with its name; no scope toggle and no live line, a cockpit link instead', async () => {
  serve(withPrs)
  await render()
  expect(host.querySelector('.m-scope')).toBeNull()
  expect(needs()).toEqual(['vault', 'docs · PR #13', 'mission round4'])
  expect([...host.querySelectorAll('.needs-list .nd-repo')].map((e) => e.textContent)).toEqual(['mnemo-desktop', 'mnemo', 'mnemo'])
  expect(host.querySelector('.m-needs-count')?.textContent).toBe('3')
  expect(host.querySelector('.m-live')).toBeNull()
  expect(host.textContent).not.toContain('writing the cockpit pane')
})

test('a blocked child keeps its reply field, prefilled; clicking it opens the mission pane', async () => {
  await render()
  const blocked = host.querySelector('.nd-blocked')!
  expect(blocked.querySelector('.m-needs')?.textContent).toBe('may I add a crate?')
  expect(blocked.querySelector('textarea')?.value).toBe('yes')
  await act(async () => (blocked.querySelector('.nd-row') as HTMLElement).click())
  expect(Object.values(appStore.getState().panes).find((p) => p.view === 'mission')?.props).toEqual({ id: '094c6a03' })
})

test('no sessions at all says so', async () => {
  serve({ repos: [], errors: [], at: '' })
  await render()
  expect(host.querySelector('.m-empty')?.textContent).toBe('no live sessions')
})

test('the expand button opens the cockpit pane', async () => {
  await render()
  await act(async () => (host.querySelector('.m-cockpit') as HTMLButtonElement).click())
  expect(Object.values(appStore.getState().panes).some((p) => p.view === 'cockpit')).toBe(true)
})

test('a PR ready to merge is listed; a finished child whose worktree is gone is not a repo', async () => {
  const m = snapshot.repos[0].missions[0]
  const pr = { number: 7, url: 'https://github.com/me/d/pull/7', state: 'OPEN', head: 'feat/round3/cockpit', ci: 'pass' as const }
  const gone = { root: '/Users/me/github/mnemo-desktop-wt-c-old', name: 'mnemo-desktop-wt-c-old', parents: [], missions: [], children: [{ ...snapshot.repos[1].children[0], id: 'dead0001', live: false, state: 'done', updated_at: new Date().toISOString() }] }
  serve({ ...snapshot, repos: [{ ...snapshot.repos[0], missions: [{ ...m, pieces: [{ ...m.pieces[0], pr }, m.pieces[1]] }] }, gone] })
  await render()
  expect(needs()).toEqual(['vault', 'cockpit · PR #7'])
  expect(host.querySelector('.nd-ready .nd-word')?.textContent).toBe('merge')
})

const tabRows = () => [...host.querySelectorAll<HTMLElement>('.ws-tab')]
const names = () => tabRows().map((r) => r.querySelector('.ws-name')?.textContent)
const leaf = (pane: number) => ({ kind: 'leaf' as const, pane })
const mouse = (el: Element, type = 'mousedown') => act(() => void el.dispatchEvent(new MouseEvent(type, { bubbles: true })))

test('the tab list: Home first, a row per tab, new tab last; Home is highlighted with no tab active', async () => {
  await render()
  expect(names()).toEqual(['Home', 'new tab'])
  expect(tabRows()[0].className).toContain('active')
  await act(async () => mouse(tabRows()[1]))
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
  expect(appStore.getState().tabs).toHaveLength(1)
  expect(tabRows()[0].className).not.toContain('active')
  expect(tabRows()[1].className).toContain('active')
  mouse(tabRows()[0])
  expect(appStore.getState().activeTab).toBe('')
  mouse(tabRows()[1])
  expect(appStore.getState().activeTab).toBe(appStore.getState().tabs[0].id)
})

test('tabs are named by what runs in them, with repo · branch and a Claude state dot', async () => {
  const desktopRoot = '/Users/me/github/mnemo-desktop'
  homeStore.setState({
    snapshot: {
      repos: [{ root: desktopRoot, name: 'mnemo-desktop', last_at: 0, pinned: false, hidden: false, unresolved: false, children: [], sessions: [{ id: '0ff9d810-aaaa', title: 'wire the workspace column', cwd: desktopRoot, last_at: 0, transcript: true, live: 'here', kind: 'interactive', agent: null }] }],
      clone_base: '', errors: [], protected: 0,
    },
  })
  appStore.setState({
    tabs: [
      { id: 't1', root: leaf(1), focused: 1 },
      { id: 't2', root: leaf(2), focused: 2 },
      { id: 't3', root: leaf(3), focused: 3 },
      { id: 't4', root: leaf(-1), focused: -1 },
      { id: 't5', root: leaf(-2), focused: -2 },
      { id: 't6', root: leaf(4), focused: 4, name: 'my build' },
    ],
    activeTab: 't1',
    panes: {
      1: { id: 1, view: 'terminal', cwd: desktopRoot, sessionId: '0ff9d810-aaaa' },
      2: { id: 2, view: 'terminal', cwd: '/Users/me/scratch', title: 'vim notes.md' },
      3: { id: 3, view: 'terminal', cwd: '/Users/me/scratch/' },
      4: { id: 4, view: 'terminal', cwd: '/tmp' },
      [-1]: { id: -1, view: 'cockpit', props: {}, title: 'cockpit' },
      [-2]: { id: -2, view: 'editor', props: { path: '/Users/me/github/mnemo-desktop/src/App.tsx', root: desktopRoot } },
    },
  })
  await render()
  expect(names()).toEqual(['Home', 'wire the workspace column', 'vim notes.md', 'scratch', 'cockpit', 'editor · App.tsx', 'my build', 'new tab'])
  const claude = tabRows()[1]
  expect(claude.querySelector('.ws-sub')?.textContent).toBe('mnemo-desktop · main')
  // The parent row of that session is busy.
  expect(claude.querySelector('.ws-dot')?.className).toBe('ws-dot ws-working')
  expect(tabRows()[2].querySelector('.ws-dot')?.className).toBe('ws-dot')
  expect(tabRows()[2].querySelector('.ws-sub')?.textContent).toBe('scratch')
  expect(tabRows()[4].querySelector('.ws-sub')).toBeNull()
})

test('a Claude session Home does not know yet is named by its agent name, and Home is asked again', async () => {
  const load = vi.spyOn(homeStore.getState(), 'load')
  homeStore.setState({ load })
  appStore.setState({
    tabs: [{ id: 't1', root: leaf(1), focused: 1 }],
    activeTab: 't1',
    panes: { 1: { id: 1, view: 'terminal', cwd: '/Users/me/github/mnemo-desktop', sessionId: '0ff9d810-aaaa' } },
  })
  await render()
  expect(names()[1]).toBe('round3 dispatch')
  expect(load).toHaveBeenCalledTimes(1)
})

test('× closes a tab; double-click renames it, Enter keeps the name, an empty name clears it, Escape cancels', async () => {
  appStore.setState({
    tabs: [{ id: 't1', root: leaf(-1), focused: -1 }, { id: 't2', root: leaf(-2), focused: -2 }],
    activeTab: 't1',
    panes: { [-1]: { id: -1, view: 'cockpit', props: {} }, [-2]: { id: -2, view: 'vault', props: {} } },
  })
  await render()
  const rename = async (i: number, value: string, key: string) => {
    mouse(tabRows()[i], 'dblclick')
    const input = tabRows()[i].querySelector<HTMLInputElement>('.ws-rename')!
    expect(document.activeElement).toBe(input)
    input.value = value
    await act(async () => void input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))
  }
  await rename(1, 'triage', 'Enter')
  expect(appStore.getState().tabs[0].name).toBe('triage')
  expect(names()[1]).toBe('triage')
  await rename(1, 'nope', 'Escape')
  expect(names()[1]).toBe('triage')
  await rename(1, '  ', 'Enter')
  expect(appStore.getState().tabs[0].name).toBeUndefined()
  expect(names()[1]).toBe('cockpit')

  await act(async () => tabRows()[2].querySelector<HTMLButtonElement>('.ws-close')!.click())
  expect(appStore.getState().tabs.map((t) => t.id)).toEqual(['t1'])
})
