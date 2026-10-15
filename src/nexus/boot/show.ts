import { openWindow } from '../ui/windows'

/** Opens one of the Nexus's windows over the ship. */
export function showNexusWindow(id: string): void {
  openWindow(id)
}
