import { useShell } from './store'

/** The titlebar above and the status bar below, in px: an overlay that portals to `<body>`
 *  cannot inherit these bounds from the layout and keeps clear of them itself (Orca's numbers). */
export const TOP_CHROME = 36
export const STATUS_BAR = 24

/** Where the left sidebar ends, in px: its width while open, else 0. */
export const useLeftEdge = (): number => useShell((s) => (s.leftOpen ? s.leftWidth : 0))
