import { useStore } from 'zustand'
import { createUiStore, type QuickCommandsUi } from './ui-store'

/** The app's one menu-and-dialog state. Apart from `view.tsx`, so a hot reload of the view keeps it. */
export const uiStore = createUiStore()
export const useUi = <T,>(sel: (s: QuickCommandsUi) => T): T => useStore(uiStore, sel)
