/** A stand-in for `./upstream` in this folder's tests: the same names over plain stores, so no
 *  test touches Tauri, the live fleet or the shell. Use as `vi.mock('./upstream', () => import('./testing'))`. */
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { Action } from '../actions/registry'
import type { AgentNode, RepoNode, WorktreeNode } from '../fleet/types'
import { sidebarStore } from './store'

type Tab = { id: string; focused: number }

export const fleetStore = createStore(() => ({
  repos: [] as RepoNode[],
  markRead: vi.fn((_path: string) => {}),
  refresh: vi.fn(async () => {}),
}))

export const layoutStore = createStore(() => ({
  activeWorktree: null as string | null,
  tabs: [] as Tab[],
  activeTab: '',
  switchWorktree: vi.fn(async (_path: string) => {}),
  goToPane: vi.fn((_id: number) => {}),
}))

export const homeStore = createStore(() => ({
  loading: false,
  notice: null as string | null,
  openFolder: vi.fn(async () => {}),
  dismiss: vi.fn(() => {}),
}))

export const shellStore = createStore(() => ({ leftOpen: true }))

export const actions = new Map<string, Action>()
export const register = (a: Action) => void actions.set(a.id, a)
export const run = vi.fn((_id: string) => {})
export const mountInSlot = vi.fn((_slot: string, _c: unknown) => () => {})

export const useFleet = <T,>(sel: (f: ReturnType<typeof fleetStore.getState>) => T): T => useStore(fleetStore, sel)
export const useShell = <T,>(sel: (s: ReturnType<typeof shellStore.getState>) => T): T => useStore(shellStore, sel)

/** Fresh stores and spies, nothing folded or expanded. */
export function resetFakes() {
  fleetStore.setState({ repos: [], markRead: vi.fn(), refresh: vi.fn(async () => {}) })
  layoutStore.setState({ activeWorktree: null, tabs: [], activeTab: '', switchWorktree: vi.fn(async () => {}), goToPane: vi.fn() })
  homeStore.setState({ loading: false, notice: null, openFolder: vi.fn(async () => {}), dismiss: vi.fn() })
  shellStore.setState({ leftOpen: true })
  run.mockClear()
  sidebarStore.setState({ collapsed: new Set(), expandedAgents: new Set() })
  localStorage.clear()
}

export const agent = (sessionId: string, state: AgentNode['state'], more: Partial<AgentNode> = {}): AgentNode => ({
  sessionId,
  paneId: null,
  state,
  waitingFor: state === 'needs-you' ? 'question' : null,
  title: `session ${sessionId}`,
  since: Date.now() - 5 * 60_000,
  ...more,
})

export const tree = (path: string, more: Partial<WorktreeNode> = {}): WorktreeNode => ({
  path,
  name: path.split('/').pop()!,
  branch: path.split('/').pop()!,
  kind: 'workspace',
  agents: [],
  pr: null,
  unread: false,
  ...more,
})

export const repo = (root: string, worktrees: WorktreeNode[]): RepoNode => ({ root, name: root.split('/').pop()!, worktrees })
