import { nexusStore } from '../store'
import { openWindow } from '../ui/windows'

/** Shows the Nexus and opens one of its windows over it: a window is drawn only while the ship is. */
export function showNexusWindow(id: string): void {
  nexusStore.getState().setOpen(true)
  openWindow(id)
}
