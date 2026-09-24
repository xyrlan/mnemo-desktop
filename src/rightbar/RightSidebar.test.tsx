import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type { MemoryFeed } from '../memory/types'
import { MemoryPanel, REFRESH_MS } from './MemoryPanel'
import { RightSidebar } from './RightSidebar'
import { createMemoryStore, type MemoryActions, type MemoryState, type MemoryStore, type MemoryTarget } from './memory'
import { standaloneShell, type ShellState } from './shell'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Whether or not the shell has landed, these tests drive the sidebar through a shell of their own.
vi.mock('./shell', async (original) => {
  const m = await original<typeof import('./shell')>()
  return { ...m, useShell: <T,>(sel: (s: ShellState) => T) => useStore(m.standaloneShell, sel) }
})

// Popper-positioned content (the tooltips) is never opened here: see src/ui/primitives.test.tsx.

async function mount(node: React.ReactNode): Promise<HTMLElement> {
  const host = document.body.appendChild(document.createElement('div'))
  await act(async () => createRoot(host).render(node))
  return host
}
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))
const byLabel = (el: ParentNode, label: string) => el.querySelector<HTMLElement>(`[aria-label="${label}"]`)

const initial = standaloneShell.getState()
beforeEach(() => standaloneShell.setState({ ...initial, rightOpen: true, rightWidth: 320 }))
afterEach(() => {
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('the right sidebar', () => {
  const Hello = () => <p>hello panel</p>
  const Other = () => <p>other panel</p>
  const icon = () => <svg />
  const items = [
    { id: 'memory', icon, title: 'Memory', panel: Hello },
    { id: 'files', icon, title: 'Explorer', shortcut: '⌘⇧E', panel: Other },
  ]

  it("draws the activity bar and the first tab's panel, at the shell's width", async () => {
    const host = await mount(<RightSidebar items={items} />)
    const tabs = [...host.querySelectorAll('[role="tab"]')]
    expect(tabs.map((t) => t.getAttribute('aria-label'))).toEqual(['Memory', 'Explorer (⌘⇧E)'])
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false'])
    expect(host.textContent).toContain('hello panel')
    const frame = host.querySelector<HTMLElement>('[data-right-sidebar]')!
    expect(frame.style.width).toBe('320px')
    // Opts out of the old views' reset (`src/theme.css`), should the shell draw it inside `.app`.
    expect(frame.hasAttribute('data-ui')).toBe(true)
  })

  it('switches panel from the activity bar', async () => {
    const host = await mount(<RightSidebar items={items} />)
    await act(async () => byLabel(host, 'Explorer (⌘⇧E)')!.click())
    expect(host.textContent).toContain('other panel')
    expect(host.textContent).not.toContain('hello panel')
  })

  it('closes through the shell, and draws nothing while closed', async () => {
    const host = await mount(<RightSidebar items={items} />)
    await act(async () => byLabel(host, 'Toggle right sidebar')!.click())
    expect(standaloneShell.getState().rightOpen).toBe(false)
    expect(host.querySelector('[data-right-sidebar]')).toBeNull()
  })

  it('grows as its left edge is dragged left, within the clamps', async () => {
    window.innerWidth = 1200
    const host = await mount(<RightSidebar items={items} />)
    const handle = host.querySelector('[data-resize-handle]')!
    await act(async () => void handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 880, button: 0 })))
    await act(async () => void window.dispatchEvent(new MouseEvent('mousemove', { clientX: 800 })))
    expect(standaloneShell.getState().rightWidth).toBe(400)
    // Never under 220, never leaving the workbench less than 320 of the window.
    await act(async () => void window.dispatchEvent(new MouseEvent('mousemove', { clientX: 1150 })))
    expect(standaloneShell.getState().rightWidth).toBe(220)
    await act(async () => void window.dispatchEvent(new MouseEvent('mousemove', { clientX: 0 })))
    expect(standaloneShell.getState().rightWidth).toBe(880)
    await act(async () => void window.dispatchEvent(new MouseEvent('mouseup')))
    await act(async () => void window.dispatchEvent(new MouseEvent('mousemove', { clientX: 500 })))
    expect(standaloneShell.getState().rightWidth).toBe(880)
    expect(document.body.style.cursor).toBe('')
  })
})

const FEED: MemoryFeed = {
  project: 'mnemo-desktop',
  briefing: { sessionId: 'ca38e28b-5db0', date: '2026-09-24', tldr: 'Built the fleet model.', path: '/v/b.md' },
  fired: [
    { slug: 'run-git', name: 'Run git yourself', at: Date.now() - 3 * 60_000, source: 'reflex' },
    { slug: 'no-npm', name: 'pnpm, never npm', at: Date.now() - 2 * 3_600_000, source: 'denial' },
  ],
  learned: [{ slug: 'tauri-drop', name: 'Tauri drop position is webview-relative', at: Date.now() - 86_400_000 }],
  inbox: [{ key: 'feedback/vitest', type: 'feedback', title: 'Mock invoke with a recorder', excerpt: 'vitest 5 fails a spy that rejects a string' }],
}

/** A store that records what the panel asked of it. */
function fakeStore(state: Partial<MemoryState> = {}) {
  const calls: unknown[][] = []
  const store = createStore<MemoryState & MemoryActions>(() => ({
    target: null,
    feed: FEED,
    loading: false,
    error: null,
    deciding: {},
    failed: {},
    show: async (t) => void calls.push(['show', t]),
    refresh: async () => void calls.push(['refresh']),
    decide: async (key, how) => void calls.push(['decide', key, how]),
    ...state,
  })) as MemoryStore
  return { store, calls }
}

const T: MemoryTarget = { cwd: '/r/app', sessionId: 's1' }
const section = (host: HTMLElement, id: string) => host.querySelector<HTMLElement>(`[data-section="${id}"]`)

describe('the Memory panel', () => {
  it('shows the briefing, what fired, what was learned and the inbox, under the project', async () => {
    const { store, calls } = fakeStore()
    const host = await mount(<MemoryPanel store={store} target={T} />)
    expect(calls).toEqual([['show', T]])
    expect(host.textContent).toContain('mnemo-desktop')
    expect(section(host, 'briefing')!.querySelector('button')!.textContent).toBe('Last session')
    expect(section(host, 'briefing')!.textContent).toContain('Built the fleet model.')
    expect(section(host, 'briefing')!.textContent).toContain('ca38e28b')
    const fired = section(host, 'fired')!
    expect(fired.textContent).toContain('Fired in this session2')
    expect([...fired.querySelectorAll('[data-row]')].map((r) => r.textContent)).toEqual([
      'Run git yourselfinjected by a hook3m',
      'pnpm, never npmblocked a tool call2h',
    ])
    expect(section(host, 'learned')!.textContent).toContain('Tauri drop position is webview-relative')
    expect(section(host, 'inbox')!.textContent).toContain('Mock invoke with a recorder')
  })

  it('says "lately" without a session, and what each empty section lacks', async () => {
    const { store } = fakeStore({ feed: { project: 'p', briefing: null, fired: [], learned: [], inbox: [] } })
    const host = await mount(<MemoryPanel store={store} target={{ cwd: '/r', sessionId: null }} />)
    expect(section(host, 'fired')!.textContent).toContain('Fired lately')
    expect(host.textContent).toContain('No briefing yet')
    expect(host.textContent).toContain('No rule has fired yet')
    expect(host.textContent).toContain('Nothing learned yet')
    expect(host.textContent).toContain('Inbox is empty')
  })

  it('keeps and drops an inbox page inline', async () => {
    const { store, calls } = fakeStore()
    const host = await mount(<MemoryPanel store={store} target={T} />)
    await act(async () => byLabel(host, 'Keep Mock invoke with a recorder')!.click())
    await act(async () => byLabel(host, 'Drop Mock invoke with a recorder')!.click())
    expect(calls.slice(1)).toEqual([
      ['decide', 'feedback/vitest', 'keep'],
      ['decide', 'feedback/vitest', 'drop'],
    ])
  })

  it('shows a page being decided as busy, and a failed one with the reason', async () => {
    const { store } = fakeStore({ deciding: { 'feedback/vitest': 'keep' } })
    const host = await mount(<MemoryPanel store={store} target={T} />)
    expect(byLabel(host, 'Keeping')).not.toBeNull()
    expect(byLabel(host, 'Keep Mock invoke with a recorder')).toBeNull()
    await act(async () => store.setState({ deciding: {}, failed: { 'feedback/vitest': 'page is gone' } }))
    expect(host.querySelector('[role="alert"]')!.textContent).toBe('page is gone')
  })

  it('collapses a section and expands the briefing', async () => {
    const { store } = fakeStore()
    const host = await mount(<MemoryPanel store={store} target={T} />)
    const header = section(host, 'learned')!.querySelector('button')!
    await act(async () => header.click())
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(section(host, 'learned')!.textContent).not.toContain('Tauri drop')
    const b = host.querySelector<HTMLElement>('[data-briefing]')!
    expect(b.querySelector('p')!.className).toContain('line-clamp-4')
    await act(async () => b.click())
    expect(b.querySelector('p')!.className).not.toContain('line-clamp-4')
  })

  it("shows the core's refusal instead of the sections", async () => {
    const { store } = fakeStore({ feed: null, error: 'no mnemo vault found' })
    const host = await mount(<MemoryPanel store={store} target={T} />)
    expect(host.querySelector('[role="status"]')!.textContent).toContain('no mnemo vault found')
    expect(section(host, 'inbox')).toBeNull()
  })

  it('says so with no workspace', async () => {
    const { store, calls } = fakeStore()
    const host = await mount(<MemoryPanel store={store} target={null} />)
    expect(host.textContent).toContain('No workspace selected')
    expect(calls).toEqual([['show', null]])
  })

  it('reads again on the button, when the stamp moves, and on a timer — not on every render', async () => {
    vi.useFakeTimers()
    const { store, calls } = fakeStore()
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(<MemoryPanel store={store} target={T} stamp="working:1" />))
    await act(async () => byLabel(host, 'Refresh memory')!.click())
    await act(async () => root.render(<MemoryPanel store={store} target={{ ...T }} stamp="done:2" />))
    await act(async () => root.render(<MemoryPanel store={store} target={{ ...T }} stamp="done:2" />))
    await act(async () => void vi.advanceTimersByTime(REFRESH_MS))
    expect(calls.filter((c) => c[0] === 'refresh')).toHaveLength(3)
    expect(calls.filter((c) => c[0] === 'show')).toHaveLength(1)
  })
})

test('the live store and panel read a real feed end to end', async () => {
  const store = createMemoryStore({
    feed: async () => FEED,
    project: async () => ({ project: 'mnemo-desktop', root: '/r/app' }),
    step: async (_s, _t, keys) => ({ stdout: JSON.stringify({ dropped: keys, failed: [] }), stderr: '', code: 0 }),
  })
  const host = await mount(<MemoryPanel store={store} target={T} />)
  await flush()
  expect(section(host, 'inbox')!.textContent).toContain('Mock invoke with a recorder')
  store.setState({ feed: { ...FEED } })
  await act(async () => byLabel(host, 'Drop Mock invoke with a recorder')!.click())
  await flush()
  // The fake feed still lists it, so it comes back on the re-read: the CLI, not the panel, decides.
  expect(store.getState().deciding).toEqual({})
  expect(store.getState().failed).toEqual({})
})
