import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'

/** The sidebar's own state: which repo groups are folded and which cards show every agent. Kept
 *  outside the component so it survives the sidebar closing. Folded groups are remembered across
 *  launches (they decide what `worktree.go.N` counts); expanded agent lists are not. */
export type SidebarState = {
  collapsed: ReadonlySet<string>
  expandedAgents: ReadonlySet<string>
  toggleRepo(root: string): void
  toggleAgents(path: string): void
}

const KEY = 'mnemo.sidebar.collapsed'

function readCollapsed(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function writeCollapsed(roots: ReadonlySet<string>) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...roots]))
  } catch {
    // Storage refused (private mode, quota): folding still works for this run.
  }
}

const flip = (set: ReadonlySet<string>, v: string) => {
  const next = new Set(set)
  if (!next.delete(v)) next.add(v)
  return next
}

export function createSidebarStore() {
  return createStore<SidebarState>((set) => ({
    collapsed: new Set(readCollapsed()),
    expandedAgents: new Set(),
    toggleRepo(root) {
      set((s) => {
        const collapsed = flip(s.collapsed, root)
        writeCollapsed(collapsed)
        return { collapsed }
      })
    },
    toggleAgents(path) {
      set((s) => ({ expandedAgents: flip(s.expandedAgents, path) }))
    },
  }))
}

export const sidebarStore = createSidebarStore()
export const useSidebar = <T,>(sel: (s: SidebarState) => T): T => useStore(sidebarStore, sel)
