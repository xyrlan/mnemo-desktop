import type { ReactNode } from 'react'
import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'

/** What the Nexus lends a window, as it lends a menu its `MenuContext`: `open` opens a figure (a
 *  captain's or a robot's id) in its drawer tab as a click on it does, and closes the window so the
 *  tab is in view; false, the window left open, when the ship has no such figure. */
export type WindowContext = { open(id: string): boolean }

/** A Nexus window a piece registers: its title, an optional subtitle, and its content. `group`:
 *  'systems' puts it in the SYSTEMS menu. `params` are what `openWindow` was given. */
export type WindowDef = {
  id: string
  title: string
  group?: 'systems'
  /** Its order in its group's menu; lower first. */
  order?: number
  width?: number
  render(params: Record<string, unknown>, close: () => void, ctx: WindowContext): ReactNode
}

const defs = new Map<string, WindowDef>()

/** Registers a window (a piece's `view.ts` does, at import). A second registration of an id
 *  replaces the first. Returns the unregister. */
export function registerWindow(def: WindowDef): () => void {
  defs.set(def.id, def)
  return () => {
    if (defs.get(def.id) === def) defs.delete(def.id)
  }
}

export const windowDef = (id: string): WindowDef | undefined => defs.get(id)
export const windowsIn = (group: 'systems'): WindowDef[] => [...defs.values()].filter((d) => d.group === group).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

/** The one window open over the ship, if any. */
export type OpenWindow = { id: string; params: Record<string, unknown> }
type WindowState = { open: OpenWindow | null }
export const windowStore: StoreApi<WindowState> = createStore<WindowState>(() => ({ open: null }))
export const useOpenWindow = (): OpenWindow | null => useStore(windowStore, (s) => s.open)

/** Opens a registered window over the ship; an unknown id opens nothing. */
export function openWindow(id: string, params: Record<string, unknown> = {}): void {
  if (!defs.has(id)) return
  windowStore.setState({ open: { id, params } })
}
export const closeWindow = (): void => windowStore.setState({ open: null })
