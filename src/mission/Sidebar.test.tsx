import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'
import { snapshot } from './fixtures'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string) => (cmd === 'mission_snapshot' ? snapshot : {})),
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
  missionStore.setState({ snapshot, lastError: null, sidebarOpen: true })
  settingsStore.setState({ sidebarScope: 'repo' })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function render() {
  await act(async () => root.render(<Sidebar />))
}

const repoNames = () => [...host.querySelectorAll('.m-repo-head .m-label')].map((e) => e.textContent)

test('"this repo" with nothing focused falls back to all and says so', async () => {
  await render()
  expect(repoNames()).toEqual(['mnemo-desktop', 'mnemo', 'notes'])
  expect(host.querySelector('.m-scope-hint')?.textContent).toBe('no repo in focus, showing all')
})

test('"this repo" narrows to the focused terminal\'s repo; "all" widens and persists', async () => {
  await act(async () => {
    await appStore.getState().newTab()
  })
  const tab = appStore.getState().tabs.at(-1)!
  act(() => appStore.getState().setCwd(tab.focused, '/Users/me/github/mnemo-desktop-wt-c-cockpit'))
  await render()
  expect(repoNames()).toEqual(['mnemo-desktop'])
  expect(host.querySelector('.m-scope-hint')?.textContent).toBe('mnemo-desktop')
  expect(host.textContent).toContain('parent 210k · children 640k')

  const allButton = [...host.querySelectorAll('.m-scope button')].find((b) => b.textContent === 'all') as HTMLButtonElement
  await act(async () => allButton.click())
  expect(settingsStore.getState().sidebarScope).toBe('all')
  expect(repoNames()).toEqual(['mnemo-desktop', 'mnemo', 'notes'])
  expect(host.querySelector('.m-repo.focused .m-label')?.textContent).toBe('mnemo-desktop')
})

test('the expand button opens the cockpit pane', async () => {
  await render()
  await act(async () => (host.querySelector('.m-scope-open') as HTMLButtonElement).click())
  expect(Object.values(appStore.getState().panes).some((p) => p.view === 'cockpit')).toBe(true)
})
