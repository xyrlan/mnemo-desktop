import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'
import { snapshot } from './fixtures'
import { withPrs } from '../cockpit/fixtures'
import type { Snapshot } from './types'

// The sidebar polls on mount; it gets whatever snapshot the test serves.
const served = vi.hoisted(() => ({ snap: null as unknown }))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string) => (cmd === 'mission_snapshot' ? served.snap : {})),
}))

import Sidebar from './Sidebar'
import { missionStore } from './app-store'
import { settingsStore } from '../settings/app-store'
import { store as appStore } from '../layout/app-store'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(async () => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  serve(snapshot)
  settingsStore.setState({ sidebarScope: 'repo' })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function serve(snap: Snapshot) {
  served.snap = snap
  missionStore.setState({ snapshot: snap, lastError: null, sidebarOpen: true, drafts: {}, sent: {} })
}

async function render() {
  await act(async () => root.render(<Sidebar />))
}

const needs = () => [...host.querySelectorAll('.needs-list .nd-label')].map((e) => e.textContent)

test('"this repo" with nothing focused falls back to all and lists what needs you', async () => {
  serve(withPrs)
  await render()
  expect(host.querySelector('.m-scope-hint')?.textContent).toBe('no repo in focus, showing all')
  expect(needs()).toEqual(['vault', 'docs · PR #13', 'mission round4'])
  expect(host.querySelector('.m-needs-count')?.textContent).toBe('3')
  // The old per-repo blocks are gone; working children are only on the canvas.
  expect(host.querySelector('.m-repo')).toBeNull()
  expect(host.textContent).not.toContain('writing the cockpit pane')
  expect(host.querySelector('.m-live')?.textContent).toContain('in 3 repos')
})

test('a blocked child keeps its reply field, prefilled; clicking it opens the mission pane', async () => {
  await render()
  const blocked = host.querySelector('.nd-blocked')!
  expect(blocked.querySelector('.m-needs')?.textContent).toBe('may I add a crate?')
  expect(blocked.querySelector('textarea')?.value).toBe('yes')
  await act(async () => (blocked.querySelector('.nd-row') as HTMLElement).click())
  expect(Object.values(appStore.getState().panes).find((p) => p.view === 'mission')?.props).toEqual({ id: '094c6a03' })
})

test('"this repo" narrows to the focused terminal\'s repo; "all" widens and persists', async () => {
  await act(async () => {
    await appStore.getState().newTab()
  })
  const tab = appStore.getState().tabs.at(-1)!
  act(() => appStore.getState().setCwd(tab.focused, '/Users/me/github/mnemo-issue-40'))
  await render()
  expect(host.querySelector('.m-scope-hint')?.textContent).toBe('mnemo')
  expect(needs()).toEqual([])
  expect(host.querySelector('.m-empty')?.textContent).toBe('nothing needs you')

  const allButton = [...host.querySelectorAll('.m-scope button')].find((b) => b.textContent === 'all') as HTMLButtonElement
  await act(async () => allButton.click())
  expect(settingsStore.getState().sidebarScope).toBe('all')
  expect(needs()).toEqual(['vault'])
  expect(host.querySelector('.nd-repo')?.textContent).toBe('mnemo-desktop')
})

test('no sessions at all says so', async () => {
  serve({ repos: [], errors: [], at: '' })
  await render()
  expect(host.querySelector('.m-empty')?.textContent).toBe('no live sessions')
})

test('the expand button opens the cockpit pane', async () => {
  await render()
  await act(async () => (host.querySelector('.m-scope-open') as HTMLButtonElement).click())
  expect(Object.values(appStore.getState().panes).some((p) => p.view === 'cockpit')).toBe(true)
})

test('a PR ready to merge is listed; a finished child whose worktree is gone is not a repo', async () => {
  const m = snapshot.repos[0].missions[0]
  const pr = { number: 7, url: 'https://github.com/me/d/pull/7', state: 'OPEN', head: 'feat/round3/cockpit', ci: 'pass' as const }
  const gone = { root: '/Users/me/github/mnemo-desktop-wt-c-old', name: 'mnemo-desktop-wt-c-old', parents: [], missions: [], children: [{ ...snapshot.repos[1].children[0], id: 'dead0001', live: false, state: 'done', updated_at: new Date().toISOString() }] }
  serve({ ...snapshot, repos: [{ ...snapshot.repos[0], missions: [{ ...m, pieces: [{ ...m.pieces[0], pr }, m.pieces[1]] }] }, gone] })
  settingsStore.setState({ sidebarScope: 'all' })
  await render()
  expect(needs()).toEqual(['vault', 'cockpit · PR #7'])
  expect(host.querySelector('.nd-ready .nd-word')?.textContent).toBe('merge')
  expect(host.querySelector('.m-live')?.textContent).toBe('2 live in 1 repo · cockpit ⤢')
})
