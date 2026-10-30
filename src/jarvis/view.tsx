/** James, Jarvis's assistant (#503, #505): `App.tsx` imports every `src/<dir>/view.tsx`, and this
 *  one starts the loop (`./loop`) over the Rust client and the parents, registers
 *  `jarvis.toggle` and `jarvis.listen`, hears `jarvis://heard` and the voice's errors, runs the
 *  orb (`./orb/control`) and mounts the panel in the shell's overlay slot. */
import { notifyAgent } from '../agents/notify'
import { shortcutLabel } from '../actions/chords'
import { register } from '../actions/registry'
import { mountInSlot } from '../shell/slots'
import { tauriJarvis } from './client'
import { createJarvis } from './loop'
import { tauriOrb } from './orb/api'
import { createOrbControl } from './orb/control'
import { JarvisPanel } from './panel/Panel'
import { createParents } from './parent'
import { forSpeech } from './speech'
import { addLine, createJarvisStore } from './store'

const store = createJarvisStore()

let focused = typeof document !== 'undefined' && document.hasFocus()
const onFocus = () => void (focused = true)
const onBlur = () => void (focused = false)
window.addEventListener('focus', onFocus)
window.addEventListener('blur', onBlur)

const jarvis = createJarvis({ client: tauriJarvis, parents: createParents(), store, focused: () => focused, notify: notifyAgent })

register({ id: 'jarvis.toggle', title: 'James (open / close)', run: () => store.setState((s) => ({ open: !s.open })) })

// James on screen while a conversation is on, without the panel (#506): with it on, a take no
// longer opens the panel; the chord and the launcher do.
const orb = createOrbControl({ store, api: tauriOrb, spoken: forSpeech })

register({
  id: 'jarvis.listen',
  title: 'James: hands-free on/off',
  run: async () => {
    try {
      const on = await tauriJarvis.listen(!(await tauriJarvis.listen()))
      addLine(store, { who: 'note', text: on ? 'Mãos livres ligado: diga «James».' : 'Mãos livres desligado.' })
    } catch (e) {
      store.setState({ open: true })
      addLine(store, { who: 'note', text: `Mãos livres: ${e instanceof Error ? e.message : String(e)}`, error: true })
    }
  },
})

/** Outside Tauri (plain Vite) there is no event bus: nothing is heard. */
const listening = (start: () => Promise<() => void>): Promise<(() => void) | undefined> => {
  try {
    return start().catch(() => undefined)
  } catch {
    return Promise.resolve(undefined)
  }
}
// A take shows the panel, so what James does with it is seen, unless the orb shows it.
const unlistenHeard = listening(() =>
  tauriJarvis.onHeard((h) => {
    if (orb.opensPanel()) store.setState({ open: true })
    void jarvis.heard(h)
  }),
)
const unlistenVoice = listening(() => tauriJarvis.onVoice((voice) => store.setState({ voice })))
// No microphone, a model that would not download, a speaker that would not open: said in the
// panel, which opens for it as it does for a take.
const unlistenVoiceError = listening(() =>
  tauriJarvis.onVoiceError((message) => {
    store.setState({ open: true })
    addLine(store, { who: 'note', text: `Voz: ${message}`, error: true })
  }),
)
// What came right again, as hands-free once a microphone opens after it waited for one: said in
// the panel too, which it does not open.
const unlistenVoiceNote = listening(() => tauriJarvis.onVoiceNote((message) => addLine(store, { who: 'note', text: `Voz: ${message}` })))

function Jarvis() {
  return <JarvisPanel store={store} jarvis={jarvis} shortcut={shortcutLabel('jarvis.toggle')} />
}
const unmount = mountInSlot('overlay', Jarvis)

import.meta.hot?.dispose(() => {
  jarvis.dispose()
  orb.dispose()
  window.removeEventListener('focus', onFocus)
  window.removeEventListener('blur', onBlur)
  void unlistenHeard.then((u) => u?.())
  void unlistenVoice.then((u) => u?.())
  void unlistenVoiceError.then((u) => u?.())
  void unlistenVoiceNote.then((u) => u?.())
  unmount()
})
