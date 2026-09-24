import type React from 'react'
import { useSyncExternalStore } from 'react'

export type RightbarPanel = {
  id: string
  title: string
  icon: React.ComponentType<{ className?: string }>
  order: number
  panel: React.ComponentType
}

let items: RightbarPanel[] = []
const listeners = new Set<() => void>()

/** Add a tab to the right sidebar; the returned function removes it. Registering an id again replaces it. */
export function registerRightbarPanel(item: RightbarPanel): () => void {
  items = [...items.filter((i) => i.id !== item.id), item].sort((a, b) => a.order - b.order)
  listeners.forEach((l) => l())
  return () => {
    if (!items.includes(item)) return
    items = items.filter((i) => i !== item)
    listeners.forEach((l) => l())
  }
}

export const rightbarPanels = (): RightbarPanel[] => items

export function useRightbarPanels(): RightbarPanel[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    rightbarPanels,
  )
}
