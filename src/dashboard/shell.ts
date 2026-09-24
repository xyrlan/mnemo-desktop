import { useShell } from '../shell/store'

export { mountInSlot } from '../shell/slots'
export type { ShellSlot } from '../shell/slots'

/** Where the left sidebar ends, in px: its width while open, else 0. */
export const useLeftEdge = (): number => useShell((s) => (s.leftOpen ? s.leftWidth : 0))
