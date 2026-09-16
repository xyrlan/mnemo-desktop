/** The vault square. No pane view: it lives in `view.tsx` because App imports every
 *  `src/*\/view.tsx`, and that import is where it starts filling the sidebar's
 *  `VaultLevelSlot` (see `mount.tsx`). */
import { invoke } from '@tauri-apps/api/core'
import { pulseStore } from '../pulse/app-store'
import { makeLevelClient } from './client'
import { fillSlots } from './mount'
import Square from './Square'

const client = makeLevelClient(invoke)
const stop = fillSlots(document.body, () => <Square client={client} pulses={pulseStore} />)

import.meta.hot?.dispose(stop)
