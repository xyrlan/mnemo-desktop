import { createStore as createZustand, type StoreApi } from 'zustand/vanilla'
import { useStore } from 'zustand'

/** The shell's own state: whether each sidebar is open, and how wide it is. The widths are the
 *  sidebars' own, whether open or not; a closed sidebar takes no room. Kept across launches. */
export type ShellState = {
  leftOpen: boolean
  rightOpen: boolean
  leftWidth: number
  rightWidth: number
  toggleLeft(): void
  toggleRight(): void
  /** Set the left sidebar's width, clamped to LEFT_MIN…LEFT_MAX. */
  setLeftWidth(px: number): void
  /** Set the right sidebar's width, clamped to RIGHT_MIN…RIGHT_MAX; on screen it also leaves
   *  the workbench room (`rightWidthFor`). */
  setRightWidth(px: number): void
}

// Orca's bounds (sidebar/index.tsx, right-sidebar/right-sidebar-width.ts).
export const LEFT_MIN = 220
export const LEFT_MAX = 500
export const RIGHT_MIN = 220
export const RIGHT_MAX = 2000
/** What a right sidebar never takes from the rest of the window. */
export const WORKBENCH_MIN = 320

export const DEFAULTS = { leftOpen: true, rightOpen: true, leftWidth: 280, rightWidth: 320 }

/** Where the shell's state is kept between launches. */
export const STORAGE_KEY = 'mnemo-desktop.shell'

type Kept = Pick<ShellState, 'leftOpen' | 'rightOpen' | 'leftWidth' | 'rightWidth'>

const clamp = (px: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(px)))

/** What `raw` (the stored JSON) says, over the defaults; a field that is missing or malformed
 *  keeps its default, and a width out of bounds is brought back in. */
export function readKept(raw: string | null): Kept {
  let v: Record<string, unknown> = {}
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    if (parsed && typeof parsed === 'object') v = parsed as Record<string, unknown>
  } catch {
    // A file another version wrote: the defaults, rather than no shell.
  }
  const bool = (x: unknown, d: boolean) => (typeof x === 'boolean' ? x : d)
  const num = (x: unknown, d: number, min: number, max: number) => (typeof x === 'number' && Number.isFinite(x) ? clamp(x, min, max) : d)
  return {
    leftOpen: bool(v.leftOpen, DEFAULTS.leftOpen),
    rightOpen: bool(v.rightOpen, DEFAULTS.rightOpen),
    leftWidth: num(v.leftWidth, DEFAULTS.leftWidth, LEFT_MIN, LEFT_MAX),
    rightWidth: num(v.rightWidth, DEFAULTS.rightWidth, RIGHT_MIN, RIGHT_MAX),
  }
}

/** The widest the right sidebar is drawn in a window `windowWidth` wide beside a left sidebar
 *  `leftWidth` wide (0 when closed): what leaves the workbench WORKBENCH_MIN, within
 *  RIGHT_MIN…RIGHT_MAX. */
export function rightMaxFor(windowWidth: number, leftWidth: number): number {
  return Math.max(RIGHT_MIN, Math.min(RIGHT_MAX, windowWidth - leftWidth - WORKBENCH_MIN))
}

/** The right sidebar's width on screen: its own `width`, down to `rightMaxFor`. The stored
 *  width is left alone, so a window made wide again gets it back. */
export function rightWidthFor(width: number, windowWidth: number, leftWidth: number): number {
  return Math.max(RIGHT_MIN, Math.min(width, rightMaxFor(windowWidth, leftWidth)))
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>

/** A shell store kept in `storage` (none: kept nowhere). */
export function createShellStore(storage: Storage | null = null): StoreApi<ShellState> {
  let initial: Kept = DEFAULTS
  try {
    initial = readKept(storage?.getItem(STORAGE_KEY) ?? null)
  } catch {
    // Storage the webview refuses: this run starts from the defaults.
  }
  const store = createZustand<ShellState>((set) => ({
    ...initial,
    toggleLeft: () => set((s) => ({ leftOpen: !s.leftOpen })),
    toggleRight: () => set((s) => ({ rightOpen: !s.rightOpen })),
    setLeftWidth: (px) => set({ leftWidth: clamp(px, LEFT_MIN, LEFT_MAX) }),
    setRightWidth: (px) => set({ rightWidth: clamp(px, RIGHT_MIN, RIGHT_MAX) }),
  }))
  if (storage) {
    store.subscribe((s, p) => {
      if (s.leftOpen === p.leftOpen && s.rightOpen === p.rightOpen && s.leftWidth === p.leftWidth && s.rightWidth === p.rightWidth) return
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify({ leftOpen: s.leftOpen, rightOpen: s.rightOpen, leftWidth: s.leftWidth, rightWidth: s.rightWidth }))
      } catch {
        // Full or refused: the shell still works, it just forgets on quit.
      }
    })
  }
  return store
}

function localStorageOrNull(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** The app's one shell store, kept in the webview's localStorage. */
export const shellStore: StoreApi<ShellState> = createShellStore(localStorageOrNull())
export const useShell = <T,>(sel: (s: ShellState) => T): T => useStore(shellStore, sel)
