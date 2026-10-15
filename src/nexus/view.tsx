import { register } from '../actions/registry'
import { settingsStore } from '../settings/app-store'
import { mountInSlot } from '../shell/slots'
import { tauriNexus } from './client'
import { NexusView } from './NexusView'
import { tauriShip } from './ship-client'
import { nexusStore } from './store'

/** The Nexus as the app mounts it: `App.tsx` imports every `src/<dir>/view.tsx`, and this one puts
 *  the full-window view in the shell's overlay slot and gives the app `nexus.toggle` (⌘0, the left
 *  sidebar's Nexus entry and ⌘K run it) and `nexus.triage` (the entry's needs-you count: the Nexus,
 *  on triage when a robot waits). The app opens on it. */
function Nexus() {
  return <NexusView client={tauriShip} usage={tauriNexus} />
}

register({ id: 'nexus.toggle', title: 'Nexus', run: () => nexusStore.getState().toggle() })
register({ id: 'nexus.triage', title: 'Nexus: who needs you', run: () => nexusStore.getState().askTriage() })

// The store opens on the Nexus; settings that say otherwise close it once they are read.
const atLaunch = settingsStore.subscribe((s) => {
  if (!s.loaded) return
  atLaunch()
  if (!s.nexusAtLaunch) nexusStore.getState().setOpen(false)
})

mountInSlot('overlay', Nexus)
