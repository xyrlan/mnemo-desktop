import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { tauriVoice, type Language, type VoiceClient } from './client'
import { firstLanguage } from './controller'

/** The language dictation listens for (#325), chosen in the Settings window: kept per machine, in
 *  this webview's storage. A first run starts on the system's language, and saves nothing. */

export const LANGUAGE_KEY = 'mnemo.voice.language'

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function readSaved(): string | null {
  try {
    return storage()?.getItem(LANGUAGE_KEY) ?? null
  } catch {
    // Storage unavailable: go by the system's languages.
    return null
  }
}

/** What was saved when the app started; null on a first run. */
export const savedLanguage = readSaved()

export const languageStore = createStore<{ language: Language }>(() => ({
  language: firstLanguage(savedLanguage, typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language])),
}))

/** Tells the backend to listen for `language`, then holds it, saved unless `persist` is false.
 *  Rejects with why the backend refused; the language is then unchanged. */
export async function chooseLanguage(language: Language, persist = true, client: Pick<VoiceClient, 'setLanguage'> = tauriVoice): Promise<void> {
  await client.setLanguage(language)
  languageStore.setState({ language })
  if (!persist) return
  try {
    storage()?.setItem(LANGUAGE_KEY, language)
  } catch {
    // Not saved; it holds for this run.
  }
}

export const useDictationLanguage = (): Language => useStore(languageStore, (s) => s.language)
