import { store as layout } from '../layout/app-store'
import { nexusStore } from '../nexus/store'
import { sessionHost } from '../session/app-host'
import { resolveTarget, type DictationTarget } from './route'

export type { DictationTarget } from './route'

/** Where dictation types now, in the app as it runs: the drawer's active terminal, or the bridge's
 *  prompt (or another text field) when it has focus; null with neither (`resolveTarget`). */
export function dictationTarget(): DictationTarget | null {
  return resolveTarget(document.activeElement, {
    nexus: nexusStore.getState(),
    sessions: sessionHost.getState().sessions,
    layout: layout.getState(),
  })
}
