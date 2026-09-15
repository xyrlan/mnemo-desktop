/** Pulse (issue #44). No pane view: it lives in `view.tsx` because App imports every
 *  `src/*\/view.tsx`, and that import is where it connects the store to `mnemo://pulse`
 *  and mounts the enforcement toasts in their own root. The pane bar and the vault graph
 *  read the store. */
import { createRoot } from 'react-dom/client'
import { connectPulse } from './app-store'
import { tauriPulse } from './client'
import Toasts from './Toasts'
import './pulse.css'

const disconnect = connectPulse(tauriPulse).catch((e) => {
  console.warn('pulse: not connected', e)
  return () => {}
})
const host = document.createElement('div')
host.className = 'pulse-host'
document.body.appendChild(host)
const root = createRoot(host)
root.render(<Toasts />)

import.meta.hot?.dispose(() => {
  void disconnect.then((d) => d())
  root.unmount()
  host.remove()
})
