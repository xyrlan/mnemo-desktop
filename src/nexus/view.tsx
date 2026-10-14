import { register } from '../actions/registry'
import { mountInSlot, useLeftEdge } from '../dashboard/shell'
import { tauriNexus } from './client'
import { NexusDrawer } from './NexusDrawer'
import { nexusStore } from './store'

/** The Nexus as the app mounts it: `App.tsx` imports every `src/<dir>/view.tsx`, and this one puts
 *  the drawer in the shell's overlay slot and gives the app `nexus.toggle` (the left sidebar's
 *  Nexus entry and ⌘K run it). */
function Nexus() {
  const leftEdge = useLeftEdge()
  return <NexusDrawer client={tauriNexus} leftEdge={leftEdge} />
}

register({ id: 'nexus.toggle', title: 'Nexus', run: () => nexusStore.getState().toggle() })

mountInSlot('overlay', Nexus)
