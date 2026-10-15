import { register } from '../actions/registry'
import { mountInSlot, useLeftEdge } from '../dashboard/shell'
import { tauriNexus } from './client'
import { NexusView } from './NexusView'
import { tauriShip } from './ship-client'
import { nexusStore } from './store'

/** The Nexus as the app mounts it: `App.tsx` imports every `src/<dir>/view.tsx`, and this one puts
 *  the full-window view in the shell's overlay slot and gives the app `nexus.toggle` (⌘0, the left
 *  sidebar's Nexus entry and ⌘K run it). The app opens on it. */
function Nexus() {
  const leftEdge = useLeftEdge()
  return <NexusView client={tauriShip} usage={tauriNexus} leftEdge={leftEdge} />
}

register({ id: 'nexus.toggle', title: 'Nexus', run: () => nexusStore.getState().toggle() })

mountInSlot('overlay', Nexus)
