import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { AgentNode, Fleet, RepoNode } from '../fleet/types'
import { AgentDashboardDrawer, closesOnOutside, STATUS_BAR, TOP_CHROME } from './AgentDashboardDrawer'
import { dashboardStore } from './store'
import { MOVING_CLASS } from './useDashboardCards'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const agent = (sessionId: string, state: AgentNode['state'], extra: Partial<AgentNode> = {}): AgentNode => ({
  sessionId,
  paneId: null,
  state,
  waitingFor: state === 'needs-you' ? 'question' : null,
  title: `agent ${sessionId}`,
  since: Date.now() - 5 * 60_000,
  ...extra,
})

const fleetOf = (states: Record<string, AgentNode['state']>, extra: Record<string, Partial<AgentNode>> = {}): RepoNode[] => [
  {
    root: '/code/app',
    name: 'app',
    worktrees: [
      {
        path: '/code/app',
        name: 'app',
        branch: 'main',
        kind: 'main',
        agents: Object.entries(states).map(([id, s]) => agent(id, s, extra[id])),
        pr: null,
        unread: false,
      },
    ],
  },
  {
    root: '/code/lib',
    name: 'lib',
    worktrees: [
      {
        path: '/code/lib-wt-fix',
        name: 'fix',
        branch: 'fix-login',
        kind: 'dispatched',
        agents: [agent('child', 'done', { paneId: 9 })],
        pr: { number: 12, state: 'open', checks: 'passing' },
        unread: true,
      },
    ],
  },
]

let calls: string[]
let fleet: StoreApi<Fleet>
let root: Root | null = null

function setup(repos: RepoNode[]) {
  calls = []
  fleet = createStore<Fleet>(() => ({
    repos,
    markRead: (path) => void calls.push(`markRead ${path}`),
    refresh: async () => {},
  }))
  const layout = {
    switchWorktree: async (path: string) => void calls.push(`switchWorktree ${path}`),
    goToPane: (id: number) => void calls.push(`goToPane ${id}`),
  }
  return { fleet, layout: () => layout }
}

async function mount(repos: RepoNode[], leftEdge = 220) {
  const deps = setup(repos)
  const host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await act(async () => root!.render(<AgentDashboardDrawer {...deps} leftEdge={leftEdge} />))
}

const open = () => act(async () => dashboardStore.getState().setOpen(true))
const sheet = () => document.querySelector<HTMLElement>('[data-agent-dashboard-sheet]')
const column = (bucket: string) => document.querySelector<HTMLElement>(`[data-bucket="${bucket}"]`)!
const idsIn = (bucket: string) => [...column(bucket).querySelectorAll('[data-agent-card]')].map((c) => c.getAttribute('data-agent-card'))

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  dashboardStore.setState({ open: false })
  document.body.innerHTML = ''
  document.documentElement.className = ''
  delete (document as { startViewTransition?: unknown }).startViewTransition
})

test('closed, the drawer draws nothing; open, it is a non-modal sheet on the drawer layer beside the sidebar', async () => {
  await mount(fleetOf({ a: 'working' }))
  expect(sheet()).toBeNull()
  await open()
  const s = sheet()!
  expect(s.className).toContain('z-drawer')
  expect(s.className).not.toContain('z-modal')
  expect(s.style.left).toBe('220px')
  expect(s.style.top).toBe(`${TOP_CHROME}px`)
  expect(s.style.bottom).toBe(`${STATUS_BAR}px`)
  // Non-modal: no scrim over the app.
  expect(document.querySelector('[data-slot="sheet-overlay"]')).toBeNull()
})

test('with the sidebar closed the drawer starts at the window edge', async () => {
  await mount(fleetOf({ a: 'working' }), 0)
  await open()
  expect(sheet()!.style.left).toBe('0px')
})

test('four columns, each agent in the one its state names, with counts', async () => {
  await mount(fleetOf({ n: 'needs-you', w1: 'working', w2: 'working', i: 'idle' }))
  await open()
  const labels = [...document.querySelectorAll('[data-bucket]')].map((c) => c.getAttribute('aria-label'))
  expect(labels).toEqual(['Needs you', 'Working', 'Done', 'Idle'])
  expect(idsIn('needs-you')).toEqual(['n'])
  expect(idsIn('working').sort()).toEqual(['w1', 'w2'])
  // The dispatched child sits among the interactive ones.
  expect(idsIn('done')).toEqual(['child'])
  expect(idsIn('idle')).toEqual(['i'])
  expect(column('working').querySelector('[data-count]')!.textContent).toBe('2')
  expect(document.body.textContent).toContain('5 total')
})

test('a card shows who, where and what it waits for', async () => {
  await mount(fleetOf({ n: 'needs-you' }))
  await open()
  const waiting = column('needs-you').querySelector('[data-agent-card]')!
  expect(waiting.textContent).toContain('agent n')
  expect(waiting.textContent).toContain('Asked you a question')
  expect(waiting.textContent).toContain('5m')
  const child = column('done').querySelector('[data-agent-card]')!
  expect(child.textContent).toContain('fix')
  expect(child.textContent).toContain('fix-login')
  expect(child.querySelector('[aria-label="Dispatched"]')).not.toBeNull()
  expect(child.querySelector('[aria-label="Open PR #12"]')).not.toBeNull()
  // Unseen and finished: bold, green check.
  expect(child.querySelector('[data-state-dot="done"]')).not.toBeNull()
  expect(child.innerHTML).toContain('font-semibold')
})

test('a finished agent already looked at settles to the idle dot, still in Done', async () => {
  const repos = fleetOf({})
  repos[1].worktrees[0].unread = false
  await mount(repos)
  await open()
  const child = column('done').querySelector('[data-agent-card]')!
  expect(child.querySelector('[data-state-dot="idle"]')).not.toBeNull()
})

test('a card click goes to its worktree, focuses its pane, marks it read and closes the drawer', async () => {
  await mount(fleetOf({}))
  await open()
  await act(async () => column('done').querySelector<HTMLButtonElement>('[data-agent-card] button')!.click())
  expect(calls).toEqual(['switchWorktree /code/lib-wt-fix', 'goToPane 9', 'markRead /code/lib-wt-fix'])
  expect(dashboardStore.getState().open).toBe(false)
})

test('an agent with no pane on screen shows its worktree only', async () => {
  await mount(fleetOf({ a: 'working' }))
  await open()
  await act(async () => column('working').querySelector<HTMLButtonElement>('[data-agent-card] button')!.click())
  expect(calls).toEqual(['switchWorktree /code/app', 'markRead /code/app'])
})

test('the board follows the fleet: a card that changes state changes column', async () => {
  await mount(fleetOf({ a: 'working' }))
  await open()
  expect(idsIn('working')).toEqual(['a'])
  await act(async () => fleet.setState({ repos: fleetOf({ a: 'needs-you' }) }))
  expect(idsIn('working')).toEqual([])
  expect(idsIn('needs-you')).toEqual(['a'])
})

test('a column change runs in a view transition; a change that moves nothing does not', async () => {
  const started: number[] = []
  let finish = () => {}
  ;(document as { startViewTransition?: unknown }).startViewTransition = (update: () => void) => {
    started.push(Date.now())
    update()
    return { finished: new Promise<void>((r) => (finish = r)) }
  }
  await mount(fleetOf({ a: 'working' }))
  await open()
  await act(async () => fleet.setState({ repos: fleetOf({ a: 'working' }, { a: { title: 'renamed' } }) }))
  expect(started).toHaveLength(0)
  expect(column('working').textContent).toContain('renamed')

  await act(async () => fleet.setState({ repos: fleetOf({ a: 'done' }) }))
  expect(started).toHaveLength(1)
  expect(idsIn('done').sort()).toEqual(['a', 'child'])
  expect(document.documentElement.classList.contains(MOVING_CLASS)).toBe(true)
  await act(async () => finish())
  expect(document.documentElement.classList.contains(MOVING_CLASS)).toBe(false)
})

test('Escape closes the drawer wherever focus is, unless something sits on top of it', async () => {
  await mount(fleetOf({ a: 'working' }))
  await open()
  const blocker = document.body.appendChild(document.createElement('div'))
  blocker.setAttribute('role', 'menu')
  blocker.setAttribute('data-state', 'open')
  const escape = () => new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  await act(async () => void document.body.dispatchEvent(escape()))
  expect(dashboardStore.getState().open).toBe(true)
  blocker.remove()
  // A terminal has focus: the board takes the Escape, and the terminal never sees it.
  const terminal = document.body.appendChild(document.createElement('textarea'))
  const heard: string[] = []
  terminal.addEventListener('keydown', (e) => heard.push(e.key))
  await act(async () => void terminal.dispatchEvent(escape()))
  expect(dashboardStore.getState().open).toBe(false)
  expect(heard).toEqual([])
  // Closed, it takes nothing.
  await act(async () => void terminal.dispatchEvent(escape()))
  expect(heard).toEqual(['Escape'])
})

test('the close button closes it', async () => {
  await mount(fleetOf({ a: 'working' }))
  await open()
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Close dashboard"]')!.click())
  expect(dashboardStore.getState().open).toBe(false)
  expect(sheet()).toBeNull()
})

// Radix's outside-pointer path does not run under jsdom's synthetic events, so the rule it defers
// to is tested on its own.
test('outside the board, a click on the sidebar beside it or focus moving out leaves it open; a click past its edge closes it', () => {
  expect(closesOnOutside(100, 220)).toBe(false)
  expect(closesOnOutside(null, 220)).toBe(false)
  expect(closesOnOutside(220, 220)).toBe(true)
  expect(closesOnOutside(900, 220)).toBe(true)
  expect(closesOnOutside(0, 0)).toBe(true)
})
