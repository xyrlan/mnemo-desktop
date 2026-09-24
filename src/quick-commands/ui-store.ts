import { createStore as createZustand, type StoreApi } from 'zustand/vanilla'

/** The dialog open now: adding a command, or editing the command at `index` of the repo's list. */
export type DialogTarget = { mode: 'add' } | { mode: 'edit'; index: number }

/** Whether the titlebar menu is open, and which dialog is. Kept in a store rather than in the
 *  button so the `quick-commands.open` action can open the menu. */
export type QuickCommandsUi = {
  menuOpen: boolean
  dialog: DialogTarget | null
  setMenuOpen(open: boolean): void
  openDialog(target: DialogTarget): void
  closeDialog(): void
}

export function createUiStore(): StoreApi<QuickCommandsUi> {
  return createZustand<QuickCommandsUi>((set) => ({
    menuOpen: false,
    dialog: null,
    setMenuOpen: (menuOpen) => set({ menuOpen }),
    // The menu closes as the dialog opens: one surface at a time.
    openDialog: (dialog) => set({ dialog, menuOpen: false }),
    closeDialog: () => set({ dialog: null }),
  }))
}
