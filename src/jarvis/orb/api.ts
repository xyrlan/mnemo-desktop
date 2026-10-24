import { invoke } from '@tauri-apps/api/core'
import { emitTo, listen } from '@tauri-apps/api/event'
import type { OrbApi } from './control'
import { ORB_EVENT, ORB_READY } from './show'

/** The orb's commands (src-tauri/src/jarvis_orb.rs) and its event, for the main window. */
export const tauriOrb: OrbApi = {
  enabled: () => invoke<boolean>('jarvis_orb_enabled'),
  show: (show) => invoke<void>('jarvis_orb', { show }),
  send: (state) => emitTo('orb', ORB_EVENT, state),
  onReady: (cb) => listen(ORB_READY, () => cb()),
}
