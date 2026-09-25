/** A stand-in for `./upstream` in this folder's tests: the same names over plain stores, so no
 *  test touches Tauri, the live fleet or the shell. Use as `vi.mock('./upstream', () => import('./testing'))`. */
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { Action } from '../actions/registry'
import type { AgentNode, RepoNode, WorktreeNode } from '../fleet/types'
import type { Snapshot } from '../mission/types'
import type { CleanupFacts, WorktreeInfo } from '../worktrees/client'
import { archiveStore } from './archive-store'
import { sidebarStore } from './store'

type Tab = { id: string; focused: number }

export const fleetStore = createStore(() => ({
  repos: [] as RepoNode[],
  markRead: vi.fn((_path: string) => {}),
  refresh: vi.fn(async () => {}),
}))

export const missionStore = createStore(() => ({ snapshot: { repos: [], errors: [], at: '' } as Snapshot }))

export const layoutStore = createStore(() => ({
  activeWorktree: null as string | null,
  tabs: [] as Tab[],
  activeTab: '',
  switchWorktree: vi.fn(async (_path: string) => {}),
  goToPane: vi.fn((_id: number) => {}),
  closeWorktree: vi.fn(async (_path: string) => {}),
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

// Plain recorders, not `vi.fn()`: a spy rejecting with a string fails the test under vitest 5.
type Call = unknown[]
function recorder<A extends unknown[], R>(impl: (...a: A) => Promise<R>) {
  const f = Object.assign((...a: A) => (f.calls.push(a), f.impl(...a)), { calls: [] as Call[], impl, reset: () => void ((f.calls.length = 0), (f.impl = impl)) })
  return f
}
/** What git says of each repo, by root: `cleanupFacts` answers from here. */
export const gitFacts = new Map<string, CleanupFacts | string>()
export const cleanupFacts = recorder(async (root: string): Promise<CleanupFacts> => {
  const f = gitFacts.get(root)
  if (typeof f === 'string') throw f
  return f ?? { base: 'origin/main', trees: [] }
})
/** `listWorktrees` answers with every tree `gitFacts` holds, for any path of the repo. */
export const listWorktrees = recorder(async (path: string): Promise<WorktreeInfo[]> => {
  for (const f of gitFacts.values()) if (typeof f !== 'string' && f.trees.some((t) => t.path === path)) return f.trees
  return []
})
/** Why `removeWorktree` refuses a path, as Tauri does: a bare string. Absent, it succeeds. */
export const refusals = new Map<string, string>()
export const removeWorktree = recorder(async (path: string, _force = false): Promise<void> => {
  if (refusals.has(path)) throw refusals.get(path)
})
export const forgetProject = recorder(async (_root: string): Promise<void> => {})
export const toast = { success: vi.fn(), error: vi.fn() }

/** A tree as `cleanupFacts` reports it. */
export const gitTree = (path: string, more: Partial<CleanupFacts['trees'][number]> = {}): CleanupFacts['trees'][number] => ({
  path,
  branch: path.split('/').pop()!,
  head: 'a'.repeat(40),
  isMain: false,
  dispatched: false,
  dirty: false,
  setupJob: null,
  merged: false,
  ...more,
})

export const useFleet = <T,>(sel: (f: ReturnType<typeof fleetStore.getState>) => T): T => useStore(fleetStore, sel)
export const useShell = <T,>(sel: (s: ReturnType<typeof shellStore.getState>) => T): T => useStore(shellStore, sel)

/** Fresh stores and spies, nothing folded or expanded. */
export function resetFakes() {
  fleetStore.setState({ repos: [], markRead: vi.fn(), refresh: vi.fn(async () => {}) })
  missionStore.setState({ snapshot: { repos: [], errors: [], at: '' } })
  layoutStore.setState({
    activeWorktree: null,
    tabs: [],
    activeTab: '',
    switchWorktree: vi.fn(async () => {}),
    goToPane: vi.fn(),
    closeWorktree: vi.fn(async () => {}),
  })
  homeStore.setState({ loading: false, notice: null, openFolder: vi.fn(async () => {}), dismiss: vi.fn() })
  shellStore.setState({ leftOpen: true })
  run.mockClear()
  sidebarStore.setState({ collapsed: new Set(), expandedAgents: new Set() })
  archiveStore.setState(archiveStore.getInitialState())
  gitFacts.clear()
  refusals.clear()
  for (const r of [cleanupFacts, listWorktrees, removeWorktree, forgetProject]) r.reset()
  toast.success.mockClear()
  toast.error.mockClear()
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
