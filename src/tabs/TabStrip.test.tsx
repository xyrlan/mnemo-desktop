import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: async () => null, Channel: class {} }))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))
// The live fleet polls Tauri; the strip only reads its repos.
vi.mock('../fleet/store', async () => {
  const { createStore } = await import('zustand/vanilla')
  const { useStore } = await import('zustand')
  const fleetStore = createStore(() => ({ repos: [] as unknown[], markRead() {}, async refresh() {} }))
  return { fleetStore, useFleet: (sel: (f: unknown) => unknown) => useStore(fleetStore, sel as never) }
})

import TabStrip, { moveTab } from './TabStrip'
import { fleetStore } from '../fleet/store'
import type { AgentNode, Fleet } from '../fleet/types'
import { store } from '../layout/app-store'
import { ELSEWHERE } from '../layout/store'
import { seenStore } from './seen'
import { strayTab } from './Elsewhere'
import { NEW_TAB_ITEMS, newTab, type NewTabKind } from './NewTabMenu'
import { TAB_DRAG_ACTIVATION_DISTANCE_PX } from './pointer-activation'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let onNew: ReturnType<typeof vi.fn<(kind: NewTabKind) => void>>
/** The panes of three tabs: notes (one pane), docs (two), web (one). */
let notes: number, docs: number, docsSplit: number, web: number

const fleet = (agents: AgentNode[]) =>
  (fleetStore as unknown as { setState(s: Partial<Fleet>): void }).setState({
    repos: [{ root: '/r', name: 'r', worktrees: [{ path: '/r', name: 'r', branch: 'main', kind: 'main', pr: null, unread: false, agents }] }],
  })
const agent = (paneId: number, state: AgentNode['state'], since = Date.now() + 1000): AgentNode => ({ sessionId: `s${paneId}`, paneId, state, waitingFor: null, title: '', since })

beforeEach(async () => {
  store.setState({ tabs: [], activeTab: '', panes: {}, activeWorktree: null, worktrees: [], parked: {} })
  seenStore.setState({ at: {}, since: 0 })
  fleet([])
  const s = store.getState()
  s.openView('editor', { root: '/r' }, 'tab', 'notes.md')
  notes = store.getState().tabs[0].focused
  s.openView('editor', { root: '/r' }, 'tab', 'docs.md')
  docs = store.getState().tabs[1].focused
  s.openView('editor', { root: '/r' }, 'split-row', 'more.md')
  docsSplit = store.getState().tabs[1].focused
  s.openView('browser', { url: 'https://example.com' }, 'tab', 'web')
  web = store.getState().tabs[2].focused
  onNew = vi.fn<(kind: NewTabKind) => void>()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root.render(<TabStrip onNew={onNew} />))
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const tabEls = () => [...host.querySelectorAll<HTMLElement>('[data-testid="sortable-tab"]')]
const tabEl = (i: number) => tabEls()[i]
const titles = () => tabEls().map((t) => t.querySelector('[data-testid="tab-title"]')?.textContent)
const tabIds = () => store.getState().tabs.map((t) => t.id)
const fire = (el: EventTarget, type: string, init: MouseEventInit = {}) =>
  act(() => void el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init })))

test('one tab per tab of the worktree shown, in order, named after its focused pane', () => {
  expect(titles()).toEqual(['editor', 'editor', 'browser'])
  expect(tabEls().map((t) => t.dataset.tabId)).toEqual(tabIds())
})

test("a tab's own name wins, and a tab of several panes says how many", async () => {
  await act(async () => store.getState().renameTab(tabIds()[1], 'Docs'))
  expect(titles()[1]).toBe('Docs')
  expect(tabEl(1).querySelector('[data-testid="tab-pane-count"]')?.textContent).toBe('2')
  expect(tabEl(0).querySelector('[data-testid="tab-pane-count"]')).toBeNull()
})

test('the active tab carries the bottom bar; the others do not', () => {
  expect(tabEls().map((t) => t.dataset.active)).toEqual(['false', 'false', 'true'])
  expect(tabEl(2).getAttribute('aria-selected')).toBe('true')
  expect(tabEl(2).querySelector('.bottom-0.h-\\[2px\\]')).not.toBeNull()
  expect(tabEl(0).querySelector('.bottom-0.h-\\[2px\\]')).toBeNull()
})

test('a click activates the tab on release', async () => {
  await fire(tabEl(0), 'pointerdown', { clientX: 10, clientY: 5 })
  expect(store.getState().activeTab).toBe(tabIds()[2])
  await fire(window, 'pointerup', { clientX: 12, clientY: 5 })
  expect(store.getState().activeTab).toBe(tabIds()[0])
  expect(tabEl(0).dataset.active).toBe('true')
})

test('a press that travelled as far as a drag does not activate', async () => {
  await fire(tabEl(0), 'pointerdown', { clientX: 10, clientY: 5 })
  await fire(window, 'pointerup', { clientX: 10 + TAB_DRAG_ACTIVATION_DISTANCE_PX, clientY: 5 })
  expect(store.getState().activeTab).toBe(tabIds()[2])
})

test('the X closes that tab and every pane in it', async () => {
  const [, second] = tabIds()
  await fire(tabEl(1).querySelector('[data-tab-close-button]')!, 'click')
  expect(tabIds()).not.toContain(second)
  expect(store.getState().panes[docs]).toBeUndefined()
  expect(store.getState().panes[docsSplit]).toBeUndefined()
  expect(tabEls()).toHaveLength(2)
})

test('pressing the X does not activate the tab', async () => {
  const x = tabEl(0).querySelector('[data-tab-close-button]')!
  await fire(x, 'pointerdown', { clientX: 1 })
  await fire(window, 'pointerup', { clientX: 1 })
  expect(store.getState().activeTab).toBe(tabIds()[2])
})

test('a middle click closes the tab', async () => {
  const first = tabIds()[0]
  await fire(tabEl(0), 'auxclick', { button: 1 })
  expect(tabIds()).not.toContain(first)
  expect(store.getState().panes[notes]).toBeUndefined()
})

test('another button\'s auxclick leaves the tab open', async () => {
  await fire(tabEl(0), 'auxclick', { button: 2 })
  expect(tabEls()).toHaveLength(3)
})

test('a double click renames in place; Enter keeps it, emptied goes back to the pane name', async () => {
  const id = tabIds()[0]
  await fire(tabEl(0), 'dblclick')
  const input = tabEl(0).querySelector<HTMLInputElement>('[data-tab-rename-input]')!
  expect(input).not.toBeNull()
  const type = (v: string) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    set.call(input, v)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  await act(async () => type('Scratch'))
  await act(async () => void input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  expect(store.getState().tabs.find((t) => t.id === id)?.name).toBe('Scratch')
  expect(titles()[0]).toBe('Scratch')

  await fire(tabEl(0), 'dblclick')
  const again = tabEl(0).querySelector<HTMLInputElement>('[data-tab-rename-input]')!
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    set.call(again, '  ')
    again.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => void again.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  expect(store.getState().tabs.find((t) => t.id === id)?.name).toBeUndefined()
})

test('Escape leaves the name as it was', async () => {
  const id = tabIds()[0]
  await fire(tabEl(0), 'dblclick')
  const input = tabEl(0).querySelector<HTMLInputElement>('[data-tab-rename-input]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Nope')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => void input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(tabEl(0).querySelector('[data-tab-rename-input]')).toBeNull()
  expect(store.getState().tabs.find((t) => t.id === id)?.name).toBeUndefined()
})

test('"+" is a menu of a terminal or a browser, each through its chord\'s action', async () => {
  const plus = host.querySelector('[aria-label="New tab"]')!
  expect(plus.getAttribute('aria-haspopup')).toBe('menu')
  // It asks which; a click alone opens nothing (the open menu is shot, not driven: Popper hangs jsdom).
  await fire(plus, 'click')
  expect(onNew).not.toHaveBeenCalled()
  expect(NEW_TAB_ITEMS.map((i) => [i.label, i.shortcut])).toEqual([
    ['New Terminal', '⌘T'],
    ['New Browser Tab', '⌘⇧B'],
  ])
  const ran: string[] = []
  newTab('terminal', (id) => ran.push(id))
  newTab('browser', (id) => ran.push(id))
  expect(ran).toEqual(['tab.new', 'tab.new-browser'])
})

test("a tab leads with its agent's state: working spins, needs-you asks, done checks", async () => {
  await act(async () => fleet([agent(notes, 'working'), agent(docsSplit, 'needs-you'), agent(web, 'done')]))
  const state = (i: number) => tabEl(i).querySelector('[data-agent-state]')?.getAttribute('data-agent-state')
  expect(tabEl(0).dataset.agentState).toBe('working')
  expect(tabEl(0).querySelector('.tab-agent-spinner')).not.toBeNull()
  expect(tabEl(1).dataset.agentState).toBe('needs-you')
  expect(state(1)).toBe('needs-you')
  // The active tab has no news: its done agent shows as a check, not a bell.
  expect(state(2)).toBe('done')
  expect(tabEl(2).querySelector('[data-testid="tab-activity-bell"]')).toBeNull()
})

test('an idle agent, or none, leaves the view icon', async () => {
  await act(async () => fleet([agent(notes, 'idle')]))
  expect(tabEl(0).querySelector('[data-view-icon="editor"]')).not.toBeNull()
  expect(tabEl(2).querySelector('[data-view-icon="browser"]')).not.toBeNull()
})

test('a tab not shown whose agent finished since it was seen is washed and belled, until shown', async () => {
  await act(async () => fleet([agent(notes, 'done')]))
  expect(tabEl(0).querySelector('[data-testid="tab-unread-wash"]')).not.toBeNull()
  expect(tabEl(0).querySelector('[data-testid="tab-activity-bell"]')).not.toBeNull()
  expect(tabEl(1).querySelector('[data-testid="tab-unread-wash"]')).toBeNull()

  await fire(tabEl(0), 'pointerdown', { clientX: 1 })
  await fire(window, 'pointerup', { clientX: 1 })
  expect(tabEl(0).querySelector('[data-testid="tab-unread-wash"]')).toBeNull()
})

test('a live ask owns the icon over past news', async () => {
  await act(async () => fleet([agent(docs, 'needs-you'), agent(docsSplit, 'done')]))
  expect(tabEl(1).querySelector('[data-testid="tab-activity-bell"]')).toBeNull()
  expect(tabEl(1).querySelector('[data-agent-state="needs-you"]')).not.toBeNull()
})

test('what happened in a tab while it was on screen is not news once you leave it', async () => {
  const shown = tabIds()[2]
  seenStore.setState({ at: {}, since: 0 })
  await act(async () => fleet([agent(web, 'done', Date.now())]))
  await fire(tabEl(0), 'pointerdown', { clientX: 1 })
  await fire(window, 'pointerup', { clientX: 1 })
  expect(store.getState().activeTab).not.toBe(shown)
  expect(tabEl(2).querySelector('[data-testid="tab-unread-wash"]')).toBeNull()
})

test('news from before the tab was last seen is not news', async () => {
  seenStore.getState().mark([tabIds()[0]], Date.now() + 5000)
  await act(async () => fleet([agent(notes, 'done', Date.now() + 1000)]))
  expect(tabEl(0).querySelector('[data-testid="tab-unread-wash"]')).toBeNull()
})

test('moveTab reorders the shown tabs, and the strip follows', async () => {
  const [a, b, c] = tabIds()
  await act(async () => moveTab(a, c))
  expect(tabIds()).toEqual([b, c, a])
  expect(tabEls().map((t) => t.dataset.tabId)).toEqual([b, c, a])
  const before = store.getState().tabs
  await act(async () => moveTab(a, a))
  expect(store.getState().tabs).toBe(before)
})

test("switching worktree shows that worktree's tabs", async () => {
  await act(async () => store.getState().switchWorktree('/r'))
  expect(tabEls()).toHaveLength(3)
  await act(async () => store.getState().switchWorktree('/other'))
  expect(tabEls()).toHaveLength(0)
  expect(host.querySelector('[aria-label="New tab"]')).not.toBeNull()
  await act(async () => store.getState().switchWorktree('/r'))
  expect(tabEls()).toHaveLength(3)
})

test('the tabs of no worktree stay out of the strip, behind a count at its end, until one is brought here', async () => {
  const elsewhere = () => host.querySelector<HTMLElement>('[data-testid="tabs-elsewhere"]')
  expect(elsewhere()).toBeNull()
  // A shell that outlived a restart in a folder no worktree holds.
  const stray = { id: 'tab-77', root: { kind: 'leaf' as const, pane: 77 }, focused: 77 }
  await act(async () => {
    store.getState().switchWorktree('/r')
    store.setState((s) => ({ panes: { ...s.panes, 77: { id: 77, view: 'terminal', cwd: '/home/me/scratch' } }, parked: { ...s.parked, [ELSEWHERE]: { tabs: [stray], activeTab: '' } } }))
  })
  expect(tabIds()).not.toContain('tab-77')
  expect(tabEls().map((t) => t.dataset.tabId)).toEqual(tabIds())
  expect(elsewhere()!.textContent).toBe('1')
  expect(elsewhere()!.getAttribute('aria-label')).toBe('1 tab outside any workspace')

  // The menu itself is not opened here: Popper content in jsdom never goes idle (see
  // src/ui/primitives.test.tsx); the `workbench-empty` preview scenario shows it. Its rows:
  const row = strayTab(stray, 'scratch', store.getState().panes[77])
  expect(row).toEqual({ id: 'tab-77', title: 'scratch', view: 'terminal', folder: '/home/me/scratch' })
  // What choosing one does.
  await act(async () => store.getState().bringTab('tab-77'))
  expect(store.getState().activeTab).toBe('tab-77')
  expect(tabEls().map((t) => t.dataset.tabId)).toEqual(tabIds())
  expect(tabIds()).toContain('tab-77')
  expect(elsewhere()).toBeNull()
})
