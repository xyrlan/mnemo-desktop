/** Voice dictation (issue #10). Voice has no pane view: it lives in `view.tsx` because
 *  App imports every `src/*\/view.tsx`, and that import is where it installs the ⌥Space
 *  chord, registers `dictation.toggle` (Mod+E, bound by the keymap), tells the backend the
 *  language (`./language`, chosen in the Settings window), and mounts Orca's indicator in the
 *  shell's overlay slot, over the Nexus. It types into the drawer's active terminal or the
 *  focused field (`./target`, Q12). */
import { tauriPty } from '../pty/client'
import { register } from '../actions/registry'
import { detectPlatform, shortcutKeys } from '../actions/chords'
import { tauriVoice } from './client'
import { createVoice } from './controller'
import { chooseLanguage, languageStore, savedLanguage } from './language'
import { insert } from './route'
import { dictationTarget } from './target'
import { settingsStore } from '../settings/app-store'
import { tauriMission } from '../mission/client'
import { holdKeys, installChord } from './chord'
import { mountInSlot } from '../shell/slots'
import { Indicator } from './Indicator'
import { fileDrops } from './files'
import { FileWork } from './FileWork'

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

const platform = detectPlatform()
const toggleKeys = shortcutKeys('dictation.toggle', platform)
const hold = holdKeys(platform)
register({
  id: 'dictation.toggle',
  title: `Dictate (start / stop) · or hold ${hold.join(platform === 'mac' ? '' : '+')} and speak`,
  run: () => voice.toggle(),
})
// The backend starts on `auto`; tell it what this run starts on, without saving a guess. The
// Settings window chooses it from then on (`./language`).
const { language } = languageStore.getState()
if (language !== 'auto') void chooseLanguage(language, savedLanguage === language).catch((e: unknown) => voice.note(`language: ${e}`))
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
// A voice note dropped on a pane (`src/terminal/file-drop.ts`) shows its transcription on it.
function VoiceFileWork() {
  return <FileWork store={fileDrops.work} />
}
const unmountFiles = mountInSlot('overlay', VoiceFileWork)

import.meta.hot?.dispose(() => {
  uninstallChord()
  void unlistenProgress.then((u) => u())
  void unlistenLost.then((u) => u())
  unmount()
  unmountFiles()
})
