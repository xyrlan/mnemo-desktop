/** Voice dictation (issue #10). Voice has no pane view: it lives in `view.tsx` because
 *  App imports every `src/*\/view.tsx`, and that import is where it installs the ⌥Space
 *  chord, registers its palette actions and mounts the pill in its own root. */
import { createRoot } from 'react-dom/client'
import { store } from '../layout/app-store'
import { tauriPty } from '../pty/client'
import { register, registerProvider } from '../actions/registry'
import { detectPlatform } from '../actions/keys'
import { tauriVoice, type Language } from './client'
import { createVoice, LANGUAGES, nextLanguage } from './controller'
import { insert, resolveTarget, withSeparator } from './route'
import { installChord } from './chord'
import Pill from './Pill'
import './voice.css'

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
  insert: (target, text) => insert(target, text, { writePty: (id, t) => tauriPty.write(id, t), typeInMonaco }),
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

const chord = detectPlatform() === 'mac' ? '⌥Space' : 'Alt+Space'
register({ id: 'voice.dictate', title: 'Dictate (start / stop)', shortcut: chord, run: () => voice.toggle() })
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
const host = document.createElement('div')
host.className = 'voice-host'
document.body.appendChild(host)
const root = createRoot(host)
root.render(<Pill store={voice.store} />)

import.meta.hot?.dispose(() => {
  uninstallChord()
  void unlistenProgress.then((u) => u())
  root.unmount()
  host.remove()
})
