import { useEffect } from 'react'
import { mountInSlot } from '../shell/slots'
import { startNexusApp } from './boot'
import { tauriNexus } from './client'
import { NexusView } from './NexusView'
import './outside-app'
import { tauriShip } from './ship-client'

// The round's pieces register themselves: each window in `windows/<id>/index.tsx`, the menus in
// `menus/index.ts` (spec `2026-10-15-nexus-app-design.md`). A piece not landed yet is absent.
import.meta.glob(['./windows/*/index.ts', './windows/*/index.tsx', './menus/index.ts'], { eager: true })

/** The Nexus as the app mounts it: `App.tsx` imports every `src/<dir>/view.tsx`, and this one puts
 *  the full-window view in the shell's overlay slot. The Nexus is the app: it is always shown. Its
 *  start (`startNexusApp`: the settings, the toaster, the first run's windows) runs while it is
 *  mounted; a second start is counted, so StrictMode's double effect runs nothing twice. */
function Nexus() {
  useEffect(() => startNexusApp(), [])
  return <NexusView client={tauriShip} usage={tauriNexus} />
}

mountInSlot('overlay', Nexus)
