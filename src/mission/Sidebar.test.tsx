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

// Answering a prompt attaches to a real child; here it only records what was asked.
const answered = vi.hoisted(() => [] as [string, string][])
vi.mock('../cockpit/approve', async (orig) => ({
  ...(await orig<typeof import('../cockpit/approve')>()),
  answerPrompt: vi.fn(async (c: { id: string }, choice: string) => void answered.push([c.id, choice])),
}))

// Reply as me types into a real child's terminal; here it only records what was typed.
const typedAsMe = vi.hoisted(() => [] as [string, string][])
vi.mock('./as-me', () => ({ typeAsMe: vi.fn(async (id: string, text: string) => void typedAsMe.push([id, text])) }))

import Sidebar from './Sidebar'
import { missionStore } from './app-store'
import { store as appStore } from '../layout/app-store'
import { leaves, type Node } from '../layout/tree'
import { accentHue } from '../home/repo-color'
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

test('a question keeps the reply field and gets a take-over link', async () => {
  await render()
  const blocked = host.querySelector('.nd-blocked')!
  expect(blocked.querySelector('.m-permission')).toBeNull()
  await act(async () => [...blocked.querySelectorAll('button')].find((b) => b.textContent === 'take over')!.click())
  expect(Object.values(appStore.getState().panes).find((p) => p.view === 'terminal-cmd')?.props).toEqual({ cmd: 'claude attach 094c6a03' })
})

test("reply as me refuses the prefilled suggestion and types the maintainer's own words into the child", async () => {
  typedAsMe.length = 0
  await render()
  const blocked = host.querySelector('.nd-blocked')!
  const asMe = blocked.querySelector<HTMLButtonElement>('button.m-as-me')!
  expect(asMe.textContent).toBe('reply as me')
  await act(async () => asMe.click())
  expect(typedAsMe).toEqual([])
  expect(blocked.querySelector('.m-error')?.textContent).toContain('suggested reply')
  await act(async () => missionStore.getState().setDraft('094c6a03', 'sim, pode adicionar a crate'))
  await act(async () => asMe.click())
  expect(typedAsMe).toEqual([['094c6a03', 'sim, pode adicionar a crate']])
  expect(blocked.querySelector('.m-sent')?.textContent).toContain('typed as you')
})

test('a child parked on a permission prompt shows the command and Approve / Deny, no reply field; y and n answer it', async () => {
  answered.length = 0
  const m = snapshot.repos[0].missions[0]
  const vault = m.pieces[1]
  const asking = { ...vault.child!, needs: 'approve Bash: cd ~/.claude/projects && ls -la', suggested_reply: null, waiting_for: 'permission prompt' }
  serve({ ...snapshot, repos: [{ ...snapshot.repos[0], missions: [{ ...m, pieces: [m.pieces[0], { ...vault, child: asking }] }] }, ...snapshot.repos.slice(1)] })
  await render()
  const blocked = host.querySelector('.nd-blocked')!
  const box = blocked.querySelector<HTMLElement>('.m-permission')!
  expect(box.querySelector('.m-perm-tool')?.textContent).toBe('Bash')
  expect(box.querySelector('.m-perm-cmd')?.textContent).toBe('cd ~/.claude/projects && ls -la')
  expect(blocked.querySelector('textarea')).toBeNull()
  const buttons = [...box.querySelectorAll('button')].map((b) => b.textContent)
  expect(buttons).toEqual(['Approve', "Approve and don't ask again", 'Deny'])

  await act(async () => [...box.querySelectorAll('button')].find((b) => b.textContent === 'Deny')!.click())
  expect(answered).toEqual([['094c6a03', 'no']])
  const press = (key: string, shiftKey = false) => act(async () => void box.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true })))
  await press('y')
  await press('Y', true)
  await press('x')
  expect(answered).toEqual([['094c6a03', 'no'], ['094c6a03', 'yes'], ['094c6a03', 'always']])
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
// A press is a press and a release: a bare mousedown would leave a drag being tracked.
const mouse = (el: Element, type = 'mousedown') =>
  act(() => {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true }))
    if (type === 'mousedown') el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  })

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

const paneRows = () => [...host.querySelectorAll<HTMLElement>('.ws-pane')]
const paneNames = () => paneRows().map((r) => r.querySelector('.ws-name')?.textContent)
const split = (a: number, b: number): Node => ({ kind: 'split', dir: 'row', ratio: 0.5, children: [leaf(a), leaf(b)] })
const DESKTOP = '/Users/me/github/mnemo-desktop'

/** A tab of two panes beside a tab of one, the group active with its second pane focused. */
function grouped() {
  appStore.setState({
    tabs: [
      { id: 't1', root: split(1, 2), focused: 2 },
      { id: 't2', root: leaf(3), focused: 3 },
    ],
    activeTab: 't1',
    panes: {
      1: { id: 1, view: 'terminal', cwd: DESKTOP },
      2: { id: 2, view: 'terminal', cwd: '/Users/me/scratch', title: 'vim notes.md' },
      3: { id: 3, view: 'terminal', cwd: '/Users/me/github/mnemo' },
    },
  })
}

test('a tab of several panes becomes a group that lists them; a tab of one stays one line', async () => {
  grouped()
  await render()
  // The group's own line says what it is and how many, never what its focused pane runs.
  expect(names()).toEqual(['Home', 'group', 'mnemo', 'new tab'])
  expect(host.querySelector('.ws-group-head .ws-sub')?.textContent).toBe('2 panes')
  expect(paneNames()).toEqual(['round3 dispatch', 'vim notes.md'])
  expect(paneRows().map((r) => r.querySelector('.ws-sub')?.textContent)).toEqual(['mnemo-desktop · main', 'scratch'])
  // The tab of one pane has no group wrapper and no extra line of its own.
  expect(host.querySelectorAll('.ws-group')).toHaveLength(1)
  // Only the focused pane of the active tab is marked.
  expect(paneRows().map((r) => r.className.includes('active'))).toEqual([false, true])
  // The dot is per pane: the parent sitting in the desktop checkout is busy, the scratch one is nothing.
  expect(paneRows()[0].querySelector('.ws-dot')?.className).toBe('ws-dot ws-working')
  expect(paneRows()[1].querySelector('.ws-dot')?.className).toBe('ws-dot')
  // …and the group's head carries the loudest of them.
  expect(host.querySelector('.ws-group-head .ws-dot')?.className).toBe('ws-dot ws-working')
})

test('each pane line carries its own repo accent, the lens’s colour for that repo', async () => {
  grouped()
  await render()
  const style = (i: number) => paneRows()[i].getAttribute('style') ?? ''
  expect(style(0)).toContain(String(accentHue(DESKTOP)))
  expect(style(1)).toContain(String(accentHue('/Users/me/scratch')))
  expect(accentHue(DESKTOP)).not.toBe(accentHue('/Users/me/scratch'))
})

test('clicking a pane line focuses that pane and shows its group', async () => {
  grouped()
  appStore.setState({ activeTab: 't2' })
  await render()
  mouse(paneRows()[0])
  expect(appStore.getState().activeTab).toBe('t1')
  expect(appStore.getState().tabs[0].focused).toBe(1)
})

/** Presses `row`, drags past the threshold and lets go over `onto`, at `x, y`. */
async function drag(row: Element, onto: Element, x = 60, y = 60) {
  const at = (el: Element, type: string, cx: number, cy: number) =>
    act(() => void el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: cx, clientY: cy })))
  await at(row, 'mousedown', 0, 0)
  await at(onto, 'mousemove', x, y)
  await at(onto, 'mouseup', x, y)
}

/** jsdom lays nothing out, so a line that a test drops on an edge of is given a box by hand. */
function box(el: Element, rect: { x: number; y: number; w: number; h: number }) {
  el.getBoundingClientRect = () =>
    ({ left: rect.x, top: rect.y, right: rect.x + rect.w, bottom: rect.y + rect.h, width: rect.w, height: rect.h, x: rect.x, y: rect.y }) as DOMRect
}

test('dragging a pane onto another group moves it there, focused, and the group it emptied closes', async () => {
  grouped()
  await render()
  await drag(paneRows()[0], tabRows()[2])
  const { tabs, activeTab } = appStore.getState()
  expect(tabs.map((t) => [t.id, leaves(t.root)])).toEqual([['t1', [2]], ['t2', [3, 1]]])
  expect(tabs[1].focused).toBe(1)
  expect(activeTab).toBe('t1')
  // t1 is down to one pane: it goes back to being one line.
  expect(names()).toEqual(['Home', 'vim notes.md', 'group', 'new tab'])

  // t1's line is now its one pane's line too: dragging it away empties the tab, which goes
  // rather than staying an empty group, and the eye follows the pane into t2.
  await drag(tabRows()[1], tabRows()[2])
  expect(appStore.getState().tabs.map((t) => t.id)).toEqual(['t2'])
  expect(appStore.getState().activeTab).toBe('t2')
  expect(leaves(appStore.getState().tabs[0].root).sort()).toEqual([1, 2, 3])
  expect(names()).toEqual(['Home', 'group', 'new tab'])
  expect(paneNames()).toHaveLength(3)
})

test('Escape during a drag drops nothing', async () => {
  grouped()
  await render()
  const before = appStore.getState().tabs
  const at = (el: Element, type: string, x: number) =>
    act(() => void el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: x })))
  await at(paneRows()[0], 'mousedown', 0)
  await at(tabRows()[2], 'mousemove', 60)
  await act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  await at(tabRows()[2], 'mouseup', 60)
  expect(appStore.getState().tabs.map((t) => leaves(t.root))).toEqual(before.map((t) => leaves(t.root)))
})

test('where in a line the pane is let go decides where it lands in that group', async () => {
  grouped()
  await render()
  box(paneRows()[0], { x: 0, y: 100, w: 200, h: 20 })
  // The top quarter of pane 1's line: above it, inside the group pane 1 belongs to.
  await drag(tabRows()[2], paneRows()[0], 100, 101)
  expect(appStore.getState().tabs[0].root).toEqual({
    kind: 'split', dir: 'row', ratio: 0.5,
    children: [{ kind: 'split', dir: 'col', ratio: 0.5, children: [leaf(3), leaf(1)] }, leaf(2)],
  })
  expect(appStore.getState().tabs.map((t) => t.id)).toEqual(['t1'])
})

test('a drag let go over nothing, or back over its own line, moves nothing', async () => {
  grouped()
  await render()
  const before = appStore.getState().tabs.map((t) => leaves(t.root))
  await drag(paneRows()[0], host.querySelector('.sidebar-body')!)
  await drag(paneRows()[0], paneRows()[0])
  expect(appStore.getState().tabs.map((t) => leaves(t.root))).toEqual(before)
})

test('the group head is a separator: it does not switch tabs when clicked', async () => {
  grouped()
  appStore.setState({ activeTab: 't2' })
  await render()
  const head = host.querySelector<HTMLElement>('.ws-group-head')!
  await act(async () => head.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })))
  // The head names the group, it is not a way into it: its panes are the lines underneath.
  expect(appStore.getState().activeTab).toBe('t2')
})

test('the group head still renames on a double click and closes with its ×', async () => {
  grouped()
  await render()
  const head = host.querySelector<HTMLElement>('.ws-group-head')!
  await act(async () => head.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
  const input = head.querySelector<HTMLInputElement>('.ws-rename')!
  expect(input).toBeTruthy()
  await act(async () => {
    input.value = 'the round'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
  expect(appStore.getState().tabs.find((t) => t.id === 't1')!.name).toBe('the round')
  expect(host.querySelector('.ws-group-head .ws-close')).toBeTruthy()
})

test('a group running Claude says so on its head, and one that is not does not', async () => {
  grouped()
  await render()
  expect(host.querySelector('.ws-group-head .ws-claude')).toBeTruthy()
  // The same group with no Claude in any pane: both panes are plain shells.
  appStore.setState({ panes: { ...appStore.getState().panes, 1: { id: 1, view: 'terminal', cwd: '/Users/me/scratch' } } })
  await render()
  expect(host.querySelector('.ws-group-head .ws-claude')).toBeNull()
})
