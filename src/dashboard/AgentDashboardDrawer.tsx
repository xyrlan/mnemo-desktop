// adapted from stablyai/orca components/dashboard/AgentDashboardDrawer.tsx
import { useCallback, useEffect, useRef } from 'react'
import type { StoreApi } from 'zustand/vanilla'
import { Sheet, SheetContent, SheetTitle } from '@/ui'
import type { Fleet } from '../fleet/types'
import { AgentKanbanBoard } from './AgentKanbanBoard'
import type { DashboardCard } from './model'
import { revealCard, useDashboard, type RevealDeps } from './store'
import { useDashboardCards } from './useDashboardCards'
import './dashboard.css'

/** The titlebar above and the status bar below: the sheet portals to `<body>`, so it cannot
 *  inherit these bounds from the layout and keeps clear of them itself (Orca's numbers). */
export const TOP_CHROME = 36
export const STATUS_BAR = 24
/** Orca's cap: past this the board is wide enough. */
const MAX_WIDTH = 1294

// Escape closes what sits on top of the board — a menu, a dialog — before the board itself,
// which Radix also marks role="dialog" and is told apart by its own data attribute.
const ESCAPE_BLOCKING = [
  '[data-slot="dropdown-menu-content"][data-state="open"]',
  '[data-slot="context-menu-content"][data-state="open"]',
  '[data-slot="popover-content"][data-state="open"]',
  '[role="dialog"][data-state="open"]:not([data-agent-dashboard-sheet])',
  '[role="alertdialog"][data-state="open"]',
  '[role="menu"][data-state="open"]',
  '[role="listbox"][data-state="open"]',
].join(', ')

/** Whether an interaction outside the board closes it: `x` is where the pointer went down (null
 *  for focus moving out, into a terminal say, which never closes it), `edge` the board's left
 *  edge. The sidebar beside it stays usable — its Agent Dashboard entry toggles the board itself —
 *  and a click anywhere past the edge, on the workbench, closes it. */
export const closesOnOutside = (x: number | null, edge: number): boolean => x !== null && x >= edge

/** Mounted only while the sheet is open (Radix unmounts closed content), so the fleet is not
 *  turned into cards while nobody looks. */
function DrawerBody({ fleet, onReveal, onClose }: { fleet: StoreApi<Fleet>; onReveal: (card: DashboardCard) => void; onClose: () => void }) {
  const cards = useDashboardCards(fleet)
  return <AgentKanbanBoard cards={cards} onReveal={onReveal} onClose={onClose} className="h-full w-full bg-transparent" />
}

export type DrawerProps = Pick<RevealDeps, 'layout' | 'openChild'> & {
  fleet: StoreApi<Fleet>
  /** Where the left sidebar ends, in px: the drawer opens from there. */
  leftEdge: number
}

/** The agent dashboard: a non-modal sheet that expands from the left sidebar's edge and leaves
 *  the rest of the app working — the sidebar stays clickable beside it. */
export function AgentDashboardDrawer({ fleet, layout, openChild, leftEdge }: DrawerProps) {
  const open = useDashboard((s) => s.open)
  const setOpen = useDashboard((s) => s.setOpen)
  const boardRef = useRef<HTMLDivElement | null>(null)
  const close = useCallback(() => setOpen(false), [setOpen])

  const reveal = useCallback(
    (card: DashboardCard) => {
      revealCard(card, { layout, fleet: () => fleet.getState(), openChild })
      close()
    },
    [layout, fleet, openChild, close],
  )

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector(ESCAPE_BLOCKING)) return
      // The board takes this Escape: a focused terminal must not get it too, where it would
      // interrupt the agent running there.
      e.preventDefault()
      e.stopPropagation()
      close()
    }
    // Non-modal: focus may be anywhere (a terminal) when Escape should still close it.
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, close])

  const left = `${leftEdge}px`

  /** Radix asks to close on any pointer or focus outside, and on Escape; it is never obeyed
   *  (`onOpenChange` only opens), and `closesOnOutside` decides instead. */
  const guardOutside = (event: CustomEvent<{ originalEvent: PointerEvent | FocusEvent }>) => {
    event.preventDefault()
    const original = event.detail.originalEvent
    const x = 'clientX' in original && typeof original.clientX === 'number' ? original.clientX : null
    const edge = boardRef.current?.closest<HTMLElement>('[data-slot="sheet-content"]')?.getBoundingClientRect().left ?? leftEdge
    if (closesOnOutside(x, edge)) close()
  }
  const onOpenChange = useCallback((next: boolean) => void (next && setOpen(true)), [setOpen])

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        side="left"
        showCloseButton={false}
        aria-describedby={undefined}
        className="agent-dashboard-sheet z-drawer bg-worktree-sidebar p-0 sm:max-w-none dark:bg-worktree-sidebar"
        style={{ left, top: TOP_CHROME, bottom: STATUS_BAR, height: 'auto', width: `min(calc(100vw - ${left}), ${MAX_WIDTH}px)` }}
        data-agent-dashboard-sheet=""
        // Radix focuses the first header button on open, which lights hover affordances nobody
        // hovered.
        onOpenAutoFocus={(e) => e.preventDefault()}
        onPointerDownOutside={guardOutside}
        onFocusOutside={guardOutside}
      >
        <SheetTitle className="sr-only">Agents</SheetTitle>
        <div ref={boardRef} className="flex min-h-0 flex-1 flex-col">
          <DrawerBody fleet={fleet} onReveal={reveal} onClose={close} />
        </div>
      </SheetContent>
    </Sheet>
  )
}
