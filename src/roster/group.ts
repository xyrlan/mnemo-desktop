// How the roster is grouped: by attention (the bands) or by project. It is the roster's own
// state, kept across launches; the route does not carry it.

import { create } from 'zustand'
import type { Group } from './model'

const KEY = 'mnemo.roster.group'

const kept = (): Group => {
  try {
    return localStorage.getItem(KEY) === 'project' ? 'project' : 'attention'
  } catch {
    return 'attention'
  }
}

export const groupStore = create<{ group: Group }>(() => ({ group: kept() }))

export const useGroup = (): Group => groupStore((s) => s.group)

export function setGroup(group: Group): void {
  groupStore.setState({ group })
  try {
    localStorage.setItem(KEY, group)
  } catch {
    // storage refused: the store is the group
  }
}

/** What `G` does: by attention, by project, and back. */
export const toggleGroup = (): void => setGroup(groupStore.getState().group === 'project' ? 'attention' : 'project')
