import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => ({})) }))

import { missionStore } from '../mission/app-store'
import { store as appStore } from '../layout/app-store'
import { paneView } from '../panes/registry'
import { all } from '../actions/registry'
import { snapshot } from '../mission/fixtures'
import './view'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  // Fresh timestamps so pruneSnapshot keeps every fixture child.
  missionStore.setState({ snapshot, lastError: null, looked: {}, drafts: {}, sent: {} })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function render() {
  const View = paneView('cockpit')!
  act(() => root.render(<View id={-1} props={{}} />))
}

test('registers the cockpit view and the cockpit.open action', () => {
  expect(paneView('cockpit')).toBeDefined()
  expect(all().find((a) => a.id === 'cockpit.open')?.shortcut).toBe('⌘⇧B')
})

test('renders one column per repo with full rows', () => {
  render()
  const cols = [...host.querySelectorAll('.ck-column')]
  expect(cols.map((c) => c.getAttribute('data-root'))).toEqual(['/Users/me/github/mnemo-desktop', '/Users/me/github/mnemo', '/Users/me/notes'])
  expect(host.querySelector('.ck-head')?.textContent).toContain('3 repos')

  const desktop = cols[0]
  expect(desktop.querySelector('.m-repo')?.classList.contains('m-full')).toBe(true)
  expect(desktop.textContent).toContain('mission round3')
  expect(desktop.textContent).toContain('parent 210k · children 640k')
  expect(desktop.textContent).toContain('dispatched 2 children')
  expect(desktop.textContent).toContain('writing the cockpit pane')
  expect(desktop.textContent).toContain('feat/round3/cockpit')

  // The blocked child's reply field is open, prefilled with the suggested reply.
  const blocked = desktop.querySelector('.m-blocked')!
  expect(blocked.querySelector('.m-needs')?.textContent).toBe('may I add a crate?')
  expect(blocked.querySelector('textarea')?.value).toBe('yes')

  expect(cols[1].textContent).toContain('issue 40')
  // No token fields in the snapshot: no token line, no zeros.
  expect(cols[1].textContent).not.toContain('parent 0')
})

test('highlights the column of the focused repo', async () => {
  await act(async () => {
    await appStore.getState().newTab()
  })
  const tab = appStore.getState().tabs.at(-1)!
  act(() => appStore.getState().setCwd(tab.focused, '/Users/me/github/mnemo-issue-40'))
  render()
  expect(host.querySelector('.ck-column.focused')?.getAttribute('data-root')).toBe('/Users/me/github/mnemo')
})

test('clicking a child opens its mission pane', () => {
  render()
  act(() => (host.querySelector('.ck-column .m-child .m-row') as HTMLElement).click())
  const mission = Object.values(appStore.getState().panes).find((p) => p.view === 'mission')
  expect(mission?.props).toEqual({ id: 'a43d3832' })
})

test('shows the empty state and errors', () => {
  missionStore.setState({ snapshot: { repos: [], errors: ['gh missing on PATH'], at: '' }, lastError: null })
  render()
  expect(host.textContent).toContain('no live sessions')
  expect(host.textContent).toContain('gh missing on PATH')
})
