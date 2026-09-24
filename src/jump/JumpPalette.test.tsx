import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { RepoNode, WorktreeNode } from '../fleet/types'
import { JumpPalette, type JumpPaletteProps } from './JumpPalette'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// cmdk measures its list with ResizeObserver and scrolls the selection into view; jsdom has neither.
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = RO
Element.prototype.scrollIntoView ??= function () {}

const NOW = 1_000_000_000
const tree = (name: string, over: Partial<WorktreeNode> = {}): WorktreeNode => ({
  path: `/code/${name}`,
  name,
  branch: `feat/${name}`,
  kind: 'workspace',
  agents: [],
  pr: null,
  unread: false,
  ...over,
})
const REPOS: RepoNode[] = [
  {
    root: '/code/app',
    name: 'app',
    worktrees: [
      tree('app', { kind: 'main', branch: 'main' }),
      tree('fix-login', { agents: [{ sessionId: 's1', paneId: null, state: 'needs-you', waitingFor: 'question', title: 't', since: NOW - 5 * 60_000 }], unread: true }),
    ],
  },
  { root: '/code/site', name: 'site', worktrees: [tree('blog')] },
]

let host: HTMLDivElement
let root: Root
let props: JumpPaletteProps
const jumps: string[] = []
const openChanges: boolean[] = []

beforeEach(() => {
  jumps.length = 0
  openChanges.length = 0
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  props = {
    open: true,
    onOpenChange: (o) => void openChanges.push(o),
    repos: REPOS,
    activeWorktree: '/code/app',
    onJump: (p) => void jumps.push(p),
    now: NOW,
  }
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function render(over: Partial<JumpPaletteProps> = {}) {
  props = { ...props, ...over }
  await act(async () => root.render(<JumpPalette {...props} />))
}
const rows = () => [...document.querySelectorAll<HTMLElement>('[cmdk-item]')]
const names = () => rows().map((r) => r.querySelector('.font-semibold')!.textContent)
const input = () => document.querySelector<HTMLInputElement>('[cmdk-input]')!
const selected = () => document.querySelector<HTMLElement>('[cmdk-item][data-selected="true"]')

async function type(text: string) {
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    set.call(input(), text)
    input().dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function key(k: string) {
  await act(async () => input().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })))
}

it('lists every worktree of the fleet, most recently active first', async () => {
  await render()
  expect(names()).toEqual(['fix-login', 'app', 'blog'])
  expect(document.body.textContent).toContain('Jump to worktree')
})

it('shows each row’s status, age, branch, repo and chips', async () => {
  await render()
  const [fix, app, blog] = rows()
  expect(fix.querySelector('[role="img"]')!.getAttribute('aria-label')).toBe('Needs you, unread')
  expect(fix.querySelector('[role="img"]')!.getAttribute('data-state')).toBe('needs-you')
  expect(fix.querySelector('[aria-label="Last active 5m ago"]')!.textContent).toBe('5m')
  expect(fix.textContent).toContain('feat/fix-login')
  expect(fix.textContent).toContain('app')
  expect(app.textContent).toContain('Current')
  expect(app.textContent).toContain('primary')
  expect(fix.textContent).not.toContain('Current')
  expect(blog.querySelector('[role="img"]')!.getAttribute('aria-label')).toBe('No agent')
  expect(blog.textContent).toContain('site')
  expect(blog.textContent).not.toMatch(/\dm|\dh|\dd|<1m/)
})

it('filters as you type and highlights what matched', async () => {
  await render()
  await type('blo')
  expect(names()).toEqual(['blog'])
  const marks = [...rows()[0].querySelectorAll('mark[data-match]')].map((m) => m.textContent)
  expect(marks).toEqual(['blo'])
})

it('selects the best match of each query', async () => {
  await render()
  expect(selected()!.getAttribute('data-value')).toBe('/code/fix-login')
  await type('site')
  expect(selected()!.getAttribute('data-value')).toBe('/code/blog')
})

it('says so when nothing matches, and when the fleet is empty', async () => {
  await render()
  await type('zzzz')
  expect(rows()).toHaveLength(0)
  expect(document.body.textContent).toContain('No matching worktrees')
  await act(async () => root.unmount())
  root = createRoot(host)
  await render({ repos: [] })
  expect(document.body.textContent).toContain('No worktrees yet')
})

it('jumps to the selected worktree on Enter, and closes', async () => {
  await render()
  await key('ArrowDown')
  expect(selected()!.getAttribute('data-value')).toBe('/code/app')
  await key('Enter')
  expect(jumps).toEqual(['/code/app'])
  expect(openChanges).toEqual([false])
})

it('jumps on a click', async () => {
  await render()
  await act(async () => rows()[2].click())
  expect(jumps).toEqual(['/code/blog'])
})

it('starts afresh each time it opens', async () => {
  await render()
  await type('blog')
  expect(names()).toEqual(['blog'])
  await render({ open: false })
  await render({ open: true })
  expect(input().value).toBe('')
  expect(names()).toEqual(['fix-login', 'app', 'blog'])
})

it('renders nothing while closed', async () => {
  await render({ open: false })
  expect(document.querySelector('[cmdk-root]')).toBeNull()
})
