import type { ComponentType } from 'react'
import { createStore as createZustand } from 'zustand/vanilla'
import { useStore } from 'zustand'

/**
 * Where a screen draws into the shell. Each piece mounts itself from its own
 * `src/<dir>/view.tsx` (which `App.tsx` imports by glob), so no piece edits the shell:
 *
 *     mountInSlot('status-bar', StatusBar)
 *
 * - `left-sidebar`, `right-sidebar`: the sidebar's content. The shell draws the column — its
 *   width (`useShell`), its collapse, its border and the resize handle on the seam — and the
 *   component fills it (`h-full`); a closed sidebar's component stays mounted, hidden. Nothing
 *   mounted there: no column at all.
 * - `status-bar`: the bar along the bottom. The component draws the whole bar (Orca's h-6,
 *   `border-t`); with none mounted, the shell holds the row with an empty strip of that height.
 * - `titlebar-right`: a cluster at the right end of the window's top band (the top-right group's
 *   tab row), before the right-sidebar toggle. The tab rows themselves are the workbench's own:
 *   one per group (src/tab-group), not a slot.
 * - `overlay`: drawers, dialogs, palettes, the pet, notification stacks — rendered once at the
 *   root after everything else, inside the shell's `TooltipProvider`; each positions itself
 *   (fixed, or a Radix portal).
 *
 * A slot draws its components in the order they were mounted, each inside its own error
 * boundary. Mounting the same component in the same slot twice draws it once, until both
 * mounts are undone.
 *
 * In dev, a hot reload runs a `view.tsx` again, and its second `mountInSlot` brings a new
 * function of the same name. That mount takes the earlier one's place (and its position) instead
 * of drawing a second copy; the earlier mount's undo then does nothing. So in dev two different
 * components in one slot need different names; a component with no name is never replaced.
 */
export type ShellSlot = 'left-sidebar' | 'right-sidebar' | 'status-bar' | 'titlebar-right' | 'overlay'

export const SLOTS: readonly ShellSlot[] = ['left-sidebar', 'right-sidebar', 'status-bar', 'titlebar-right', 'overlay']

/** One component in one slot; `key` tells React two entries apart. */
export type SlotEntry = { key: number; component: ComponentType }

type Mounted = SlotEntry & { count: number }
type Slots = Record<ShellSlot, readonly Mounted[]>

const empty = () => Object.fromEntries(SLOTS.map((s) => [s, []])) as unknown as Slots

const slots = createZustand<Slots>(empty)
let nextKey = 1

const nameOf = (c: ComponentType) => c.displayName || c.name
/** The same view's component, run again by a hot reload. */
const sameName = (a: ComponentType, b: ComponentType) => nameOf(a) !== '' && nameOf(a) === nameOf(b)

/** Draw `component` in `slot`. Returns the way to take it out again; calling that more than
 *  once takes it out once. */
export function mountInSlot(slot: ShellSlot, component: ComponentType): () => void {
  if (!SLOTS.includes(slot)) throw new Error(`mountInSlot: no slot named ${JSON.stringify(slot)}`)
  slots.setState((s) => {
    const had = s[slot].find((e) => e.component === component)
    if (had) return { [slot]: s[slot].map((e) => (e === had ? { ...e, count: e.count + 1 } : e)) }
    const reloaded = import.meta.env.DEV ? s[slot].find((e) => sameName(e.component, component)) : undefined
    if (reloaded) return { [slot]: s[slot].map((e) => (e === reloaded ? { key: e.key, component, count: 1 } : e)) }
    return { [slot]: [...s[slot], { key: nextKey++, component, count: 1 }] }
  })
  let mounted = true
  return () => {
    if (!mounted) return
    mounted = false
    slots.setState((s) => ({
      [slot]: s[slot].flatMap((e) => (e.component !== component ? [e] : e.count > 1 ? [{ ...e, count: e.count - 1 }] : [])),
    }))
  }
}

/** The components drawn in `slot` now, in mount order. */
export function slotEntries(slot: ShellSlot): readonly SlotEntry[] {
  return slots.getState()[slot]
}

/** `slotEntries`, as a hook: the same array until the slot changes. */
export function useSlot(slot: ShellSlot): readonly SlotEntry[] {
  return useStore(slots, (s) => s[slot])
}

/** Empties every slot. For tests. */
export function resetSlots() {
  slots.setState(empty())
}
