import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => ({})) }))

import { missionStore } from '../mission/app-store'
import { store as appStore } from '../layout/app-store'
import { settingsStore } from '../settings/app-store'
import { paneView } from '../panes/registry'
import { all } from '../actions/registry'
import { withPrs } from './fixtures'
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
  settingsStore.setState({ sidebarScope: 'all' })
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
