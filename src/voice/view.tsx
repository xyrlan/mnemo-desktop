/** Voice dictation (issue #10). Voice has no pane view: it lives in `view.tsx` because
 *  App imports every `src/*\/view.tsx`, and that import is where it installs the ⌥Space
 *  chord, registers `dictation.toggle` (Mod+E, bound by the keymap) and the language action,
 *  and mounts Orca's indicator in the shell's overlay slot. */
import { store } from '../layout/app-store'
import { tauriPty } from '../pty/client'
import { register, registerProvider } from '../actions/registry'
import { detectPlatform } from '../actions/keys'
import { tauriVoice, type Language } from './client'
import { createVoice, LANGUAGES, nextLanguage } from './controller'
import { insert, resolveTarget, withSeparator } from './route'
import { settingsStore } from '../settings/app-store'
import { tauriMission } from '../mission/client'
import { installChord } from './chord'
import { mountInSlot } from '../shell/slots'
import { Indicator } from './Indicator'

async function typeInMonaco(el: HTMLElement, text: string): Promise<boolean> {
  // Already loaded: a Monaco element exists only after the editor pane imported it.
  const { monaco } = await import('../editor/monaco')
  const ed = monaco.editor.getEditors().find((e) => e.getDomNode() === el || e.getContainerDomNode().contains(el))
  const model = ed?.getModel()
  const pos = ed?.getPosition()
  if (!ed || !model || !pos) return false
  const before = model.getLineContent(pos.lineNumber).slice(0, pos.column - 1)
  ed.focus()
  ed.trigger('voice', 'type', { text: withSeparator(before, text) })
  return true
}

const voice = createVoice({
  client: tauriVoice,
  target: () => resolveTarget(document.activeElement, store.getState()),
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
    return insert(target, out, { writePty: (id, t) => tauriPty.write(id, t), typeInMonaco })
  },
})

const LANGUAGE_KEY = 'mnemo.voice.language'
let language: Language = 'auto'
try {
  const saved = localStorage.getItem(LANGUAGE_KEY) as Language | null
  if (saved && LANGUAGES.includes(saved)) language = saved
} catch {
  // Storage unavailable: stay on auto.
}

async function setLanguage(l: Language) {
  try {
    await tauriVoice.setLanguage(l)
  } catch (e) {
    return voice.note(`language: ${e}`)
  }
  language = l
  try {
    localStorage.setItem(LANGUAGE_KEY, l)
  } catch {
    // Not persisted; applies for this session.
  }
}

const mac = detectPlatform() === 'mac'
const toggleKeys = mac ? ['⌘', 'E'] : ['Ctrl', 'E']
register({ id: 'dictation.toggle', title: 'Dictate (start / stop)', shortcut: mac ? '⌘E' : 'Ctrl+E', run: () => voice.toggle() })
registerProvider(() => [
  {
    id: 'voice.language',
    title: `Voice language: ${language} → ${nextLanguage(language)}`,
    run: async () => {
      await setLanguage(nextLanguage(language))
      voice.note(`voice language: ${language}`)
    },
  },
])

if (language !== 'auto') void setLanguage(language)
const uninstallChord = installChord(voice)
const unlistenProgress = tauriVoice.onProgress(voice.progress)
function DictationIndicator() {
  return <Indicator store={voice.store} shortcut={toggleKeys} onStop={() => void voice.end()} />
}
const unmount = mountInSlot('overlay', DictationIndicator)

import.meta.hot?.dispose(() => {
  uninstallChord()
  void unlistenProgress.then((u) => u())
  unmount()
})
