import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'

const h = vi.hoisted(() => ({
  mounts: [] as number[],
  unmounts: [] as number[],
  openFolder: vi.fn(async () => {}),
  settings: {} as { skipPermissions?: boolean },
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: async () => null, Channel: class {} }))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))
// The pane frames have their own tests (SplitView, remount): a probe per pane, flat and keyed by
// pane as the real layer is, placed where its tab is and counting mounts.
vi.mock('../layout/SplitView', async () => {
  const { createElement, Fragment, useEffect } = await import('react')
  const { leaves } = await import('../layout/tree')
  const { boxStyle } = await import('../chrome/geometry')
  type Placed = { tab: { id: string; root: Parameters<typeof leaves>[0] }; place: Parameters<typeof boxStyle>[0] | null; dim?: boolean }
  function Probe({ id, tab, place, dim }: { id: number; tab: string; place: Placed['place']; dim?: boolean }) {
    useEffect(() => {
      h.mounts.push(id)
      return () => void h.unmounts.push(id)
    }, [id])
    return createElement('div', { 'data-probe': id, 'data-tab': tab, className: dim ? 'is-dim' : '', style: place ? boxStyle(place) : { display: 'none' } })
  }
  return {
    PaneLayer: ({ tabs }: { tabs: Placed[] }) =>
      createElement(Fragment, null, ...tabs.flatMap(({ tab, place, dim }) => leaves(tab.root).map((id) => createElement(Probe, { key: id, id, tab: tab.id, place, dim })))),
  }
})
vi.mock('../fleet/store', async () => {
  const { createStore } = await import('zustand/vanilla')
  const { useStore } = await import('zustand')
  const fleetStore = createStore(() => ({ repos: [] as unknown[], markRead() {}, async refresh() {} }))
  return { fleetStore, useFleet: (sel: (f: unknown) => unknown) => useStore(fleetStore, sel) }
})
vi.mock('../home/app-store', () => {
  const home = { openFolder: h.openFolder, snapshot: { repos: [], clone_base: '', errors: [], protected: 0 } }
  return { homeStore: { getState: () => home }, useHome: (sel: (s: typeof home) => unknown) => sel(home) }
})
vi.mock('../settings/app-store', () => ({ settingsStore: { getState: () => h.settings } }))

import Workbench, { agentCommand, describeWorktree, workbenchLayers } from './Workbench'
import { createStore, ELSEWHERE, PROMPT_DELAY_MS, type Store } from '../layout/store'
import type { PtyInfo, SessionClient } from '../terminal/sessions'
import type { PtyClient } from '../pty/client'
import { fleetStore } from '../fleet/store'
import type { RepoNode } from '../fleet/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function fakePty() {
  let next = 1
  const spawned: (string | undefined)[] = []
  const writes: [number, string][] = []
  const pty: PtyClient = {
    spawn: async ({ cwd }) => {
      spawned.push(cwd)
      return next++
    },
    write: async (id, data) => void writes.push([id, data]),
    resize: async () => {},
    kill: async () => {},
    onExit: async () => () => {},
  }
  return { pty, spawned, writes }
}

const A = '/code/app'
const B = '/code/app-wt-login'
const repos: RepoNode[] = [
  {
    root: A,
    name: 'app',
    worktrees: [
      { path: A, name: 'app', branch: 'main', kind: 'main', agents: [], pr: null, unread: false },
      { path: B, name: 'login', branch: 'feat/login', kind: 'workspace', agents: [], pr: null, unread: false },
    ],
  },
]

let host: HTMLDivElement
let root: Root
let pty: ReturnType<typeof fakePty>
let s: Store
beforeEach(() => {
  h.mounts.length = 0
  h.unmounts.length = 0
  h.openFolder.mockClear()
  h.settings = {}
  ;(fleetStore as unknown as { setState(p: object): void }).setState({ repos })
  pty = fakePty()
  s = createStore(pty.pty, { workspace: () => null })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function render(props: { ready?: boolean; notice?: string | null; onDismissNotice?: () => void } = {}) {
  await act(async () =>
    root.render(
      <Workbench
        ready={props.ready ?? true}
        notice={props.notice ?? null}
        onDismissNotice={props.onDismissNotice ?? (() => {})}
        lead={<i data-lead />}
        trail={<i data-trail />}
        layout={s}
      />,
    ),
  )
}
const layer = (id: string) => host.querySelector<HTMLElement>(`[data-tab="${id}"]`)!
const rowOf = (group: string) => host.querySelector<HTMLElement>(`[data-tab-group-strip-id="${group}"]`)!
const shown = () => [...host.querySelectorAll<HTMLElement>('[data-tab]')].filter((el) => el.style.display !== 'none').map((el) => el.dataset.tab)
const layers = () => [...host.querySelectorAll<HTMLElement>('[data-tab]')].map((el) => el.dataset.tab)
const button = (name: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(name))!

test('every open worktree’s tabs stay mounted; only the shown worktree’s shown tab is visible', async () => {
  await s.getState().switchWorktree(A)
  await s.getState().newTab()
  await s.getState().newTab()
  await s.getState().switchWorktree(B)
  await s.getState().newTab()
  await render()
  expect(layers()).toEqual(['tab-1', 'tab-2', 'tab-3'])
  expect(shown()).toEqual(['tab-3'])
  expect(h.mounts.sort()).toEqual([1, 2, 3])

  await act(async () => s.getState().switchWorktree(A))
  expect(shown()).toEqual(['tab-2'])
  await act(async () => s.getState().goToTab(0))
  expect(shown()).toEqual(['tab-1'])
  await act(async () => s.getState().switchWorktree(B))
  expect(shown()).toEqual(['tab-3'])
  // The point of it all: a switch never remounts a pane view, so a terminal keeps its screen.
  expect(h.unmounts).toEqual([])
  expect(layers()).toEqual(['tab-1', 'tab-2', 'tab-3'])
})

test('a tab moved into another group, or to a group of its own, is never remounted', async () => {
  await s.getState().switchWorktree(A)
  await s.getState().newTab()
  await s.getState().newTab()
  await render()
  await act(async () => s.getState().moveTab('tab-1', { group: s.getState().activeGroup, side: 'right' }))
  expect(Object.keys(s.getState().groups)).toHaveLength(2)
  // Each group shows its own tab, both on screen.
  expect(shown().sort()).toEqual(['tab-1', 'tab-2'])
  const [first] = Object.keys(s.getState().groups)
  await act(async () => s.getState().moveTab('tab-2', { group: s.getState().activeGroup }))
  expect(Object.keys(s.getState().groups)).not.toContain(first)
  expect(shown()).toEqual(['tab-2'])
  expect(h.mounts.sort()).toEqual([1, 2])
  expect(h.unmounts).toEqual([])
})

test("each group's shown tab is laid over that group's body, under its row; the others stay mounted, hidden", async () => {
  await s.getState().switchWorktree(A)
  await s.getState().newTab()
  await s.getState().newTab()
  await s.getState().newTab()
  await render()
  // One group: its shown tab fills the workbench under the 36px row.
  expect(shown()).toEqual(['tab-3'])
  expect(layer('tab-3').style).toMatchObject({ left: '0px', top: '36px', width: '100%', height: 'calc(100% - 36px)' })
  const [left] = Object.keys(s.getState().groups)
  await act(async () => s.getState().moveTab('tab-3', { group: left, side: 'right' }))
  const [, right] = Object.keys(s.getState().groups)
  // Split: both groups' shown tabs are on screen, each over its own body, a seam between them.
  expect(shown().sort()).toEqual(['tab-2', 'tab-3'])
  expect(layer('tab-2').style).toMatchObject({ left: '0px', top: '36px', width: 'calc(50% - 3px)' })
  expect(layer('tab-3').style).toMatchObject({ left: 'calc(50% + 3px)', top: '36px', width: 'calc(50% - 3px)' })
  expect(rowOf(left)).not.toBeNull()
  expect(rowOf(right)).not.toBeNull()
  // The group you are not in dims a little.
  expect(layer('tab-2').classList.contains('is-dim')).toBe(true)
  expect(layer('tab-3').classList.contains('is-dim')).toBe(false)
  expect(layer('tab-1').style.display).toBe('none')
  expect(h.unmounts).toEqual([])
})

test("the window's left controls start the top-left group's row; the right cluster ends the top-right one's", async () => {
  await s.getState().switchWorktree(A)
  await render()
  // No tab yet: one row holds both, and the "+".
  expect(host.querySelector('.tab-group-row [data-lead]')).not.toBeNull()
  expect(host.querySelector('.tab-group-row [data-trail]')).not.toBeNull()
  expect(host.querySelector('.tab-group-row [aria-label="New tab"]')).not.toBeNull()
  for (let i = 0; i < 3; i++) await act(async () => s.getState().newTab())
  const g = (tab: string) => Object.values(s.getState().groups).find((x) => x.tabs.includes(tab))!.id
  await act(async () => s.getState().moveTab('tab-2', { group: g('tab-1'), side: 'right' }))
  await act(async () => s.getState().moveTab('tab-3', { group: g('tab-2'), side: 'down' }))
  // tab-1 on the left, full height; tab-2 top-right; tab-3 below it, touching no top corner.
  expect(rowOf(g('tab-1')).querySelector('[data-lead]')).not.toBeNull()
  expect(rowOf(g('tab-2')).querySelector('[data-trail]')).not.toBeNull()
  expect(rowOf(g('tab-3')).querySelector('[data-lead], [data-trail]')).toBeNull()
  expect(host.querySelectorAll('[data-lead]')).toHaveLength(1)
  expect(host.querySelectorAll('[data-trail]')).toHaveLength(1)
})

test("while Home shows, the active group's body shows the empty state; the other group's tab stays on screen", async () => {
  await s.getState().switchWorktree(B)
  await s.getState().newTab()
  await s.getState().newTab()
  await render()
  await act(async () => s.getState().moveTab('tab-2', { group: s.getState().activeGroup, side: 'right' }))
  await act(async () => s.getState().showHome())
  expect(shown()).toEqual(['tab-1'])
  const empty = host.querySelector<HTMLElement>('[data-shell-empty="worktree"]')!
  expect(empty.parentElement!.style).toMatchObject({ left: 'calc(50% + 3px)', top: '36px' })
  // Any tab shown again leaves Home.
  await act(async () => s.getState().activateTab('tab-2'))
  expect(shown().sort()).toEqual(['tab-1', 'tab-2'])
  expect(host.querySelector('[data-shell-empty]')).toBeNull()
})

test('the pane views render with no old stylesheet scope around them', async () => {
  await s.getState().newTab(A)
  await render()
  expect(host.querySelector('[data-probe]')).not.toBeNull()
  // theme.css kept the pre-redesign look alive inside `.app` until orca-redesign-f.
  expect(host.querySelector('.app')).toBeNull()
})

test('tabs opened before any worktree was chosen join the first one without remounting', async () => {
  await s.getState().newTab('/tmp')
  await render()
  expect(shown()).toEqual(['tab-1'])
  await act(async () => s.getState().switchWorktree(A))
  expect(shown()).toEqual(['tab-1'])
  expect(h.mounts).toEqual([1])
  expect(h.unmounts).toEqual([])
})

test('a closed worktree’s panes go, and the others stay', async () => {
  await s.getState().switchWorktree(A)
  await s.getState().newTab()
  await s.getState().switchWorktree(B)
  await s.getState().newTab()
  await render()
  await act(async () => s.getState().closeWorktree(A))
  expect(layers()).toEqual(['tab-2'])
  expect(h.unmounts).toEqual([1])
})

test('a worktree with no tab shows what it is and the two ways to start in it', async () => {
  await s.getState().switchWorktree(B)
  await render()
  const empty = host.querySelector('[data-shell-empty="worktree"]')!
  expect(empty.querySelector('h2')?.textContent).toBe('login')
  expect(empty.textContent).toContain('feat/login')
  expect(empty.textContent).toContain('app')

  await act(async () => button('New terminal').click())
  expect(pty.spawned).toEqual([B])
  expect(shown()).toEqual(['tab-1'])
  expect(host.querySelector('[data-shell-empty]')).toBeNull()
})

test('“Launch agent” runs claude in the worktree, skipping permission prompts unless Settings say not to', async () => {
  vi.useFakeTimers()
  try {
    await s.getState().switchWorktree(B)
    await render()
    expect(button('Launch agent').title).toBe('claude --dangerously-skip-permissions')
    await act(async () => button('Launch agent').click())
    await act(async () => void (await vi.advanceTimersByTimeAsync(PROMPT_DELAY_MS)))
    expect(pty.spawned).toEqual([B])
    expect(pty.writes).toEqual([[1, 'claude --dangerously-skip-permissions\n']])
  } finally {
    vi.useRealTimers()
  }
  expect(agentCommand(undefined)).toBe('claude --dangerously-skip-permissions')
  expect(agentCommand(true)).toBe('claude --dangerously-skip-permissions')
  expect(agentCommand(false)).toBe('claude')
})

test('with the Settings toggle off, “Launch agent” runs plain claude', async () => {
  h.settings = { skipPermissions: false }
  await s.getState().switchWorktree(B)
  await render()
  expect(button('Launch agent').title).toBe('claude')
})

test('an empty worktree says nothing until the saved workspace is restored', async () => {
  await s.getState().switchWorktree(B)
  await render({ ready: false })
  expect(host.querySelector('[data-shell-empty]')).toBeNull()
  await render({ ready: true })
  expect(host.querySelector('[data-shell-empty="worktree"]')).not.toBeNull()
})

test('with no worktree chosen and no repo known, it offers to open a folder', async () => {
  ;(fleetStore as unknown as { setState(p: object): void }).setState({ repos: [] })
  await render()
  expect(host.querySelector('[data-shell-empty="projects"]')).not.toBeNull()
  await act(async () => button('Open a folder').click())
  expect(h.openFolder).toHaveBeenCalledTimes(1)
  // A repo is known: its main checkout is about to show, and its empty state shows already
  // rather than nothing meanwhile.
  await act(async () => (fleetStore as unknown as { setState(p: object): void }).setState({ repos }))
  expect(host.querySelector('[data-shell-empty="worktree"] h2')?.textContent).toBe('app')
  await act(async () => button('New terminal').click())
  expect(pty.spawned).toEqual([A])
  expect(host.querySelector('[data-shell-empty]')).toBeNull()
})

/** `s` restored after a restart with `A` shown and no tab of its own, and a shell kept running
 *  in `~/scratch`, which no worktree holds. */
async function restartedWithAStray() {
  const held: PtyInfo[] = [{ id: 7, cwd: '/home/me/scratch', pid: 1, alive: true }]
  const sessions: SessionClient = { list: async () => held, attach: async () => new Uint8Array() }
  s = createStore(pty.pty, { workspace: () => null, sessions })
  await s.getState().restore({ version: 2, activeWorktree: A, worktrees: [{ path: A, activeTab: '', tabs: [], panes: {} }] })
}

test('a worktree with no tab of its own shows its empty state, not a shell from elsewhere', async () => {
  await restartedWithAStray()
  await render()
  expect(s.getState().tabs).toEqual([])
  expect(host.querySelector('[data-shell-empty="worktree"] h2')?.textContent).toBe('app')
  // The stray shell stays mounted, so its terminal keeps its screen, and never shows here.
  expect(layers()).toEqual(['tab-7'])
  expect(shown()).toEqual([])
})

test('a tab brought here from elsewhere shows without remounting', async () => {
  await restartedWithAStray()
  await render()
  await act(async () => s.getState().bringTab('tab-7'))
  expect(shown()).toEqual(['tab-7'])
  expect(host.querySelector('[data-shell-empty]')).toBeNull()
  expect(h.mounts).toEqual([7])
  expect(h.unmounts).toEqual([])
  expect(s.getState().worktreeTabs(ELSEWHERE)).toEqual([])
})

test('the restore’s notice shows over the workbench until dismissed', async () => {
  const dismiss = vi.fn()
  await render({ notice: 'workspace.json could not be read', onDismissNotice: dismiss })
  const notice = host.querySelector<HTMLButtonElement>('button[title="Dismiss"]')!
  expect(notice.textContent).toContain('workspace.json could not be read')
  act(() => notice.click())
  expect(dismiss).toHaveBeenCalledTimes(1)
})

test('layers: tabs opened before any worktree first, then each worktree’s in opening order, then the tabs of none', () => {
  const t = (id: string) => ({ id, root: { kind: 'leaf' as const, pane: 0 }, focused: 0 })
  expect(workbenchLayers([t('x')], [A, B], [[t('a1'), t('a2')], [t('b1')]], [t('z')]).map((l) => [l.worktree, l.tab.id])).toEqual([
    [null, 'x'],
    [A, 'a1'],
    [A, 'a2'],
    [B, 'b1'],
    [ELSEWHERE, 'z'],
  ])
})

test('a worktree the fleet does not know is named by its folder', () => {
  expect(describeWorktree(repos, B)).toEqual({ name: 'login', branch: 'feat/login', repo: 'app' })
  expect(describeWorktree(repos, '/elsewhere/tool/')).toEqual({ name: 'tool', branch: null, repo: null })
})
