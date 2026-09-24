import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import LeftSidebar from './Sidebar'
import { agent, fleetStore, homeStore, layoutStore, repo, resetFakes, run, shellStore, tree } from './testing'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./upstream', () => import('./testing'))

// Tooltips are rendered closed here: opening a popper-positioned layer in jsdom never settles
// (see src/ui/primitives.test.tsx). What they say is checked through the accessible text.

let root: Root | null = null
async function mount(): Promise<HTMLElement> {
  const host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await act(async () => root!.render(<LeftSidebar />))
  return host
}
beforeEach(() => resetFakes())
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

const click = (el: Element | null | undefined) => act(() => (el as HTMLElement).click())
const key = (el: Element, k: string) => act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })))
const card = (host: HTMLElement, path: string) => host.querySelector(`[data-worktree-path="${path}"]`)!
const surface = (host: HTMLElement, path: string) => card(host, path).querySelector('[data-worktree-card-surface]')!
const button = (host: HTMLElement, name: string) =>
  [...host.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? b.textContent)?.startsWith(name))

function fleet() {
  fleetStore.setState({
    repos: [
      repo('/r/app', [
        tree('/r/app', { kind: 'main', branch: 'main', pr: null }),
        tree('/r/app-wt-fix', {
          branch: 'fix/login',
          pr: { number: 42, state: 'open', checks: 'failing' },
          agents: [agent('s1', 'needs-you', { waitingFor: 'permission', title: 'Fix login', paneId: 7 })],
        }),
        tree('/r/app-wt-child', { kind: 'dispatched', branch: 'dispatch/9', unread: true, agents: [agent('s2', 'done', { title: 'Child #9' })] }),
      ]),
      repo('/r/web', [
        tree('/r/web', {
          kind: 'main',
          branch: null,
          agents: [agent('w1', 'working'), agent('w2', 'idle'), agent('w3', 'needs-you')],
        }),
      ]),
    ],
  })
}

test('draws each repo as a group, and a card per worktree with its name, branch and marks', async () => {
  fleet()
  const host = await mount()
  const groups = [...host.querySelectorAll('[data-repo-root]')]
  expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(['app', 'web'])
  expect([...groups[0].querySelectorAll('[role="option"]')].map((o) => o.getAttribute('data-worktree-path'))).toEqual([
    '/r/app',
    '/r/app-wt-fix',
    '/r/app-wt-child',
  ])
  expect(card(host, '/r/app-wt-fix').querySelector('[data-worktree-title]')!.textContent).toBe('app-wt-fix')
  expect(card(host, '/r/app-wt-fix').querySelector('[data-worktree-card-meta-row]')!.textContent).toContain('fix/login')
  expect(card(host, '/r/app').querySelector('[data-worktree-kind]')!.textContent).toBe('primary')
  expect(card(host, '/r/app-wt-child').querySelector('[data-worktree-kind]')!.textContent).toBe('dispatched')
  expect(card(host, '/r/app-wt-fix').querySelector('[data-worktree-kind]')).toBeNull()
  // A card with no branch and no PR has no meta row.
  expect(card(host, '/r/web').querySelector('[data-worktree-card-meta-row]')).toBeNull()
})

test('a PR shows its number and says its state and checks', async () => {
  fleet()
  const host = await mount()
  const pr = card(host, '/r/app-wt-fix').querySelector('[data-pr-badge]')!
  expect(pr.getAttribute('data-pr-badge')).toBe('open')
  expect(pr.textContent).toContain('#42')
  expect(pr.textContent).toContain('PR #42 checks: Failing')
  expect(pr.querySelector('svg')!.getAttribute('class')).toContain('text-rose-500')
})

test('the status lane shows the most urgent agent; unread adds the dot and a heavier title', async () => {
  fleet()
  const host = await mount()
  expect(card(host, '/r/app').querySelector('[data-status]')!.getAttribute('data-status')).toBe('inactive')
  expect(card(host, '/r/app-wt-fix').querySelector('[data-status]')!.getAttribute('data-status')).toBe('permission')
  expect(card(host, '/r/web').querySelector('[data-status]')!.getAttribute('data-status')).toBe('permission')

  const child = card(host, '/r/app-wt-child')
  expect(child.querySelector('[data-status]')!.getAttribute('data-status')).toBe('done')
  expect(child.querySelector('[data-worktree-unread-alert]')).not.toBeNull()
  expect(child.querySelector('[data-worktree-status-lane]')!.textContent).toBe('Done · Unread')
  expect(child.textContent).toContain('Unread:')
  expect(child.querySelector('[data-worktree-title]')!.parentElement!.className).toContain('font-semibold')
  expect(card(host, '/r/app').querySelector('[data-worktree-unread-alert]')).toBeNull()
  expect(card(host, '/r/app').querySelector('[data-worktree-title]')!.parentElement!.className).toContain('font-normal')
})

test('while an agent waits on you, the lane is its question icon, not the unread dot', async () => {
  fleetStore.setState({ repos: [repo('/r/a', [tree('/r/a', { unread: true, agents: [agent('x', 'needs-you')] })])] })
  const host = await mount()
  expect(card(host, '/r/a').querySelector('[data-status]')!.getAttribute('data-status')).toBe('permission')
  expect(card(host, '/r/a').querySelector('[data-worktree-unread-alert]')).toBeNull()
})

test('the worktree on screen is the active card; before one is chosen, the first repo’s main checkout', async () => {
  fleet()
  const host = await mount()
  expect(surface(host, '/r/app').getAttribute('data-worktree-card-active')).toBe('primary')
  expect(card(host, '/r/app').getAttribute('aria-selected')).toBe('true')

  await act(async () => layoutStore.setState({ activeWorktree: '/r/app-wt-fix' }))
  expect(surface(host, '/r/app').getAttribute('data-worktree-card-active')).toBeNull()
  expect(surface(host, '/r/app-wt-fix').getAttribute('data-worktree-card-active')).toBe('primary')
  expect(card(host, '/r/app-wt-fix').getAttribute('tabindex')).toBe('0')
  expect(card(host, '/r/app').getAttribute('tabindex')).toBe('-1')
})

test('clicking a card switches to its worktree and marks it read', async () => {
  fleet()
  const host = await mount()
  click(surface(host, '/r/app-wt-child'))
  expect(layoutStore.getState().switchWorktree).toHaveBeenCalledWith('/r/app-wt-child')
  expect(fleetStore.getState().markRead).toHaveBeenCalledWith('/r/app-wt-child')
})

test('one agent is a row: its dot, title, what it asks, and age; a click goes to its pane, not just the card', async () => {
  fleet()
  const host = await mount()
  const row = card(host, '/r/app-wt-fix').querySelector('[data-agent-session="s1"]')!
  expect(row.querySelector('[data-agent-dot]')!.getAttribute('data-agent-dot')).toBe('permission')
  expect(row.textContent).toBe('Fix login - needs permission5m')
  click(row)
  expect(layoutStore.getState().goToPane).toHaveBeenCalledWith(7)
  expect(layoutStore.getState().switchWorktree).not.toHaveBeenCalled()
  expect(fleetStore.getState().markRead).toHaveBeenCalledWith('/r/app-wt-fix')
})

test('the agent row in the focused pane is lifted', async () => {
  fleet()
  layoutStore.setState({ activeWorktree: '/r/app-wt-fix', tabs: [{ id: 't', focused: 7 }], activeTab: 't' })
  const host = await mount()
  expect(card(host, '/r/app-wt-fix').querySelector('[data-agent-session="s1"]')!.getAttribute('data-focused-agent-pane')).toBe('true')
})

test('several agents fold into a pill, attention first, that opens into their rows without switching', async () => {
  fleet()
  const host = await mount()
  const web = card(host, '/r/web')
  const pill = web.querySelector('[data-compact-agent-list] button')!
  expect([...pill.querySelectorAll('[data-summary-group]')].map((g) => g.getAttribute('data-summary-group'))).toEqual(['waiting', 'working', 'idle'])
  expect(pill.getAttribute('aria-expanded')).toBe('false')
  expect(pill.getAttribute('aria-label')).toBe('Expand 3 agents: 1 waiting for input, 1 working, 1 idle')
  expect(web.querySelector('.compact-agent-expansion-content')).toBeNull()

  click(pill)
  expect(pill.getAttribute('aria-expanded')).toBe('true')
  const rows = [...web.querySelectorAll('[data-agent-session]')].map((r) => r.getAttribute('data-agent-session'))
  expect(rows).toEqual(['w3', 'w1', 'w2'])
  expect(layoutStore.getState().switchWorktree).not.toHaveBeenCalled()

  click(pill)
  expect(pill.getAttribute('aria-expanded')).toBe('false')
})

test('nav: Search, Tasks and the Agent Dashboard run their pieces’ actions; the dashboard counts states', async () => {
  fleet()
  const host = await mount()
  click(button(host, 'Search'))
  click(button(host, 'Tasks'))
  click(button(host, 'Agent Dashboard'))
  expect(run.mock.calls.map((c) => c[0])).toEqual(['worktree.jump', 'tasks.open', 'dashboard.toggle'])
  const counts = [...host.querySelectorAll('[data-bucket]')].map((b) => [b.getAttribute('data-bucket'), b.textContent])
  expect(counts).toEqual([
    ['needs-you', '2'],
    ['working', '1'],
    ['done', '1'],
  ])
})

test('the dashboard entry leaves out a state no agent is in, and shows no counts for an idle fleet', async () => {
  fleetStore.setState({ repos: [repo('/r/a', [tree('/r/a', { agents: [agent('x', 'working'), agent('y', 'idle')] })])] })
  const host = await mount()
  expect([...host.querySelectorAll('[data-bucket]')].map((b) => b.getAttribute('data-bucket'))).toEqual(['working'])
  await act(async () => fleetStore.setState({ repos: [repo('/r/a', [tree('/r/a', { agents: [agent('y', 'idle')] })])] }))
  expect(host.querySelectorAll('[data-bucket]')).toHaveLength(0)
})

test('New workspace runs workspace.new', async () => {
  const host = await mount()
  click(button(host, 'New workspace'))
  expect(run).toHaveBeenCalledWith('workspace.new')
})

test('Add project goes through Home; a folder it refuses is said under the header until dismissed', async () => {
  const host = await mount()
  await act(async () => (button(host, 'Add project') as HTMLElement).click())
  expect(homeStore.getState().openFolder).toHaveBeenCalledTimes(1)
  expect(host.querySelector('[role="alert"]')).toBeNull()

  homeStore.setState({ openFolder: vi.fn(async () => homeStore.setState({ notice: 'não é um repositório git' })) })
  await act(async () => (button(host, 'Add project') as HTMLElement).click())
  expect(host.querySelector('[role="alert"]')!.textContent).toBe('não é um repositório git')
  click(button(host, 'Dismiss'))
  expect(host.querySelector('[role="alert"]')).toBeNull()
})

test('a repo header folds its cards away, and the folded header still says what is urgent inside', async () => {
  fleet()
  const host = await mount()
  const header = host.querySelector('[data-repo-root="/r/app"] [data-repo-header]')!
  expect(header.getAttribute('aria-expanded')).toBe('true')
  click(header)
  expect(header.getAttribute('aria-expanded')).toBe('false')
  expect(host.querySelector('[data-repo-root="/r/app"] [role="option"]')).toBeNull()
  const folded = header.querySelector('[data-repo-folded]')!
  expect(folded.querySelector('[data-status]')!.getAttribute('data-status')).toBe('permission')
  expect(folded.querySelector('[aria-label="Unread"]')).not.toBeNull()
  expect(folded.textContent).toBe('3')
  expect(JSON.parse(localStorage.getItem('mnemo.sidebar.collapsed')!)).toEqual(['/r/app'])

  key(header, 'Enter')
  expect(host.querySelectorAll('[data-repo-root="/r/app"] [role="option"]')).toHaveLength(3)
})

test('a folded repo shows its most urgent card: one waiting on you outranks one working', async () => {
  fleetStore.setState({
    repos: [repo('/r/a', [tree('/r/a', { agents: [agent('x', 'working')] }), tree('/r/a-wt-q', { agents: [agent('y', 'needs-you')] }), tree('/r/a-wt-d', { agents: [agent('z', 'done')] })])],
  })
  const host = await mount()
  click(host.querySelector('[data-repo-header]'))
  expect(host.querySelector('[data-repo-folded] [data-status]')!.getAttribute('data-status')).toBe('permission')
  await act(async () => fleetStore.setState({ repos: [repo('/r/a', [tree('/r/a', { agents: [agent('z', 'done')] }), tree('/r/a-wt-x', { agents: [agent('x', 'working')] })])] }))
  expect(host.querySelector('[data-repo-folded] [data-status]')!.getAttribute('data-status')).toBe('working')
  await act(async () => fleetStore.setState({ repos: [repo('/r/a', [tree('/r/a', { agents: [agent('d', 'idle')] })])] }))
  expect(host.querySelector('[data-repo-folded] [data-status]')).toBeNull()
})

test('arrow keys walk the cards, Enter shows the one with focus', async () => {
  fleet()
  const host = await mount()
  const first = card(host, '/r/app') as HTMLElement
  act(() => first.focus())
  key(first, 'ArrowDown')
  expect(document.activeElement).toBe(card(host, '/r/app-wt-fix'))
  key(document.activeElement!, 'End')
  expect(document.activeElement).toBe(card(host, '/r/web'))
  key(document.activeElement!, 'ArrowUp')
  expect(document.activeElement).toBe(card(host, '/r/app-wt-child'))
  key(document.activeElement!, 'Enter')
  expect(layoutStore.getState().switchWorktree).toHaveBeenCalledWith('/r/app-wt-child')

  const webHeader = host.querySelector('[data-repo-root="/r/web"] [data-repo-header]')!
  key(webHeader, 'ArrowDown')
  expect(document.activeElement).toBe(card(host, '/r/web'))
  key(webHeader, 'ArrowUp')
  expect(document.activeElement).toBe(card(host, '/r/app-wt-child'))
})

test('with no repos it says how to get one, but not while Home is still loading', async () => {
  homeStore.setState({ loading: true })
  const host = await mount()
  expect(host.querySelector('[data-sidebar-empty]')!.textContent).toBe('')
  await act(async () => homeStore.setState({ loading: false }))
  expect(host.querySelector('[data-sidebar-empty]')!.textContent).toBe('Add a project to see its workspaces here.')
})

test('while the shell has the sidebar collapsed it draws nothing', async () => {
  fleet()
  shellStore.setState({ leftOpen: false })
  const host = await mount()
  expect(host.innerHTML).toBe('')
})
