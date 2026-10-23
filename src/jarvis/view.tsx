/** James, Jarvis's assistant (#503, #505): `App.tsx` imports every `src/<dir>/view.tsx`, and this
 *  one starts the loop (`./loop`) over the Rust client and the parents, registers
 *  `jarvis.toggle`, hears `jarvis://heard`, and mounts the panel in the shell's overlay slot. */
import { notifyAgent } from '../agents/notify'
import { shortcutLabel } from '../actions/chords'
import { register } from '../actions/registry'
import { mountInSlot } from '../shell/slots'
import { tauriJarvis } from './client'
import { createJarvis } from './loop'
import { JarvisPanel } from './panel/Panel'
import { createParents } from './parent'
import { createJarvisStore } from './store'

const store = createJarvisStore()

let focused = typeof document !== 'undefined' && document.hasFocus()
const onFocus = () => void (focused = true)
const onBlur = () => void (focused = false)
window.addEventListener('focus', onFocus)
window.addEventListener('blur', onBlur)

const jarvis = createJarvis({ client: tauriJarvis, parents: createParents(), store, focused: () => focused, notify: notifyAgent })

register({ id: 'jarvis.toggle', title: 'James (open / close)', run: () => store.setState((s) => ({ open: !s.open })) })

/** Outside Tauri (plain Vite) there is no event bus: nothing is heard. */
const listening = (start: () => Promise<() => void>): Promise<(() => void) | undefined> => {
  try {
    return start().catch(() => undefined)
  } catch {
    return Promise.resolve(undefined)
  }
}
// A take shows the panel, so what James does with it is seen.
const unlistenHeard = listening(() =>
  tauriJarvis.onHeard((h) => {
    store.setState({ open: true })
    void jarvis.heard(h)
  }),
)
const unlistenVoice = listening(() => tauriJarvis.onVoice((voice) => store.setState({ voice })))

function Jarvis() {
  return <JarvisPanel store={store} jarvis={jarvis} shortcut={shortcutLabel('jarvis.toggle')} />
}
const unmount = mountInSlot('overlay', Jarvis)

import.meta.hot?.dispose(() => {
  jarvis.dispose()
  window.removeEventListener('focus', onFocus)
  window.removeEventListener('blur', onBlur)
  void unlistenHeard.then((u) => u?.())
  void unlistenVoice.then((u) => u?.())
  unmount()
})
