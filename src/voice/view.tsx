/** Voice dictation (issue #10). Voice has no pane view: it lives in `view.tsx` because
 *  App imports every `src/*\/view.tsx`, and that import is where it installs the ⌥Space
 *  chord, registers `dictation.toggle` (Mod+E, bound by the keymap) and the language actions,
 *  and mounts Orca's indicator in the shell's overlay slot, over the Nexus. It types into the
 *  drawer's active terminal or the focused field (`./target`, Q12). */
import { tauriPty } from '../pty/client'
import { register, registerProvider } from '../actions/registry'
import { detectPlatform, shortcutKeys } from '../actions/chords'
import { tauriVoice, type Language } from './client'
import { createVoice, firstLanguage, LANGUAGE_NAMES, LANGUAGES } from './controller'
import { insert } from './route'
import { dictationTarget } from './target'
import { settingsStore } from '../settings/app-store'
import { tauriMission } from '../mission/client'
import { holdKeys, installChord } from './chord'
import { mountInSlot } from '../shell/slots'
import { Indicator } from './Indicator'

const voice = createVoice({
  client: tauriVoice,
  target: dictationTarget,
  insert: async (target, text) => {
    let out = text
    if (settingsStore.getState().outgoing === 'en') {
      try {
        const t = (await tauriMission.translate(text)).trim()
        if (t) out = t
      } catch {
        /* dictation still lands, untranslated */
      }
    }
    return insert(target, out, { writePty: (id, t) => tauriPty.write(id, t) })
  },
})

const LANGUAGE_KEY = 'mnemo.voice.language'
let saved: string | null = null
try {
  saved = localStorage.getItem(LANGUAGE_KEY)
} catch {
  // Storage unavailable: go by the system's languages.
}
let language: Language = firstLanguage(saved, typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language])

async function setLanguage(l: Language, persist: boolean) {
  try {
    await tauriVoice.setLanguage(l)
  } catch (e) {
    return voice.note(`language: ${e}`)
  }
  language = l
  if (!persist) return
  try {
    localStorage.setItem(LANGUAGE_KEY, l)
  } catch {
    // Not persisted; applies for this session.
  }
}

const platform = detectPlatform()
const toggleKeys = shortcutKeys('dictation.toggle', platform)
const hold = holdKeys(platform)
register({
  id: 'dictation.toggle',
  title: `Dictate (start / stop) · or hold ${hold.join(platform === 'mac' ? '' : '+')} and speak`,
  run: () => voice.toggle(),
})
// One entry per language, the current one marked: found by typing "dictation" or "language".
registerProvider(() =>
  LANGUAGES.map((l) => ({
    id: `voice.language.${l}`,
    title: `Dictation language: ${LANGUAGE_NAMES[l]}${l === language ? ' (current)' : ''}`,
    run: async () => {
      await setLanguage(l, true)
      voice.note(`dictation language: ${LANGUAGE_NAMES[language]}`)
    },
  })),
)

// The backend starts on `auto`; tell it what this run starts on, without saving a guess.
if (language !== 'auto') void setLanguage(language, saved === language)
const uninstallChord = installChord(voice)
const unlistenProgress = tauriVoice.onProgress(voice.progress)
const unlistenLost = tauriVoice.onLost(voice.lost)
function DictationIndicator() {
  return (
    <Indicator
      store={voice.store}
      shortcut={toggleKeys}
      hold={hold}
      onStop={() => void voice.end()}
      onDismiss={voice.dismiss}
    />
  )
}
const unmount = mountInSlot('overlay', DictationIndicator)

import.meta.hot?.dispose(() => {
  uninstallChord()
  void unlistenProgress.then((u) => u())
  void unlistenLost.then((u) => u())
  unmount()
})
