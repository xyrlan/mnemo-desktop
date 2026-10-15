import { createStore, type StoreApi } from 'zustand/vanilla'
import type { Language, Progress, VoiceClient } from './client'
import { NOWHERE, type DictationTarget } from './route'

/** What the indicator shows. `idle` hides it. */
export type Phase =
  | { kind: 'idle' }
  /** The microphone is opening. */
  | { kind: 'starting' }
  /** `device` is the microphone's name, when it gave one. */
  | { kind: 'listening'; device: string | null }
  | { kind: 'transcribing' }
  | { kind: 'done'; text: string; landed: boolean }
  | { kind: 'note'; text: string }
  /** Stays, whole, until dismissed or the next take begins. */
  | { kind: 'error'; message: string }

export type VoiceState = {
  phase: Phase
  /** Model download fraction while the first-use download runs, else null. */
  download: number | null
}

export type Voice = {
  store: StoreApi<VoiceState>
  /** Opens a take (⌥Space's press). No-op while one is open; with nowhere to type, says so and
   *  opens nothing. */
  begin(): void
  /** Closes the take, transcribes and inserts (⌥Space's release, the indicator's Stop). */
  end(): Promise<void>
  /** `dictation.toggle` (Mod+E, the palette): begin, or end the open take. */
  toggle(): Promise<void>
  note(text: string): void
  progress(p: Progress): void
  /** The microphone stopped during the take: ends it, and `end` says why. */
  lost(why: string): void
  /** Hides an error. */
  dismiss(): void
}

export type VoiceDeps = {
  client: VoiceClient
  /** Where the take's text goes, resolved as it begins; null: nowhere. */
  target(): DictationTarget | null
  insert(target: DictationTarget, text: string): Promise<boolean>
  /** How long a result stays on the indicator, in ms. */
  linger?: number
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function createVoice(deps: VoiceDeps): Voice {
  const store = createStore<VoiceState>(() => ({ phase: { kind: 'idle' }, download: null }))
  const linger = deps.linger ?? 2000
  let timer: ReturnType<typeof setTimeout> | undefined
  const show = (phase: Phase, fade = false) => {
    clearTimeout(timer)
    store.setState({ phase })
    if (fade) timer = setTimeout(() => store.setState({ phase: { kind: 'idle' } }), linger)
  }

  /** The open take: its target and whether the microphone actually opened. */
  let take: { target: DictationTarget; opened: Promise<boolean>; ending: boolean } | null = null

  async function open(): Promise<string | null> {
    try {
      return await deps.client.start()
    } catch (e) {
      // A take left open by a reloaded webview: discard it and try once more.
      if (!message(e).includes('already recording')) throw e
      await deps.client.stop().catch(() => '')
      return deps.client.start()
    }
  }

  function begin() {
    if (take) return
    const target = deps.target()
    // Nothing is recorded that could only be thrown away.
    if (!target) return show({ kind: 'note', text: NOWHERE }, true)
    show({ kind: 'starting' })
    const t = { target, opened: Promise.resolve(false), ending: false }
    t.opened = open().then(
      (device) => {
        if (take === t && !t.ending) show({ kind: 'listening', device: device ?? null })
        return true
      },
      (e) => {
        show({ kind: 'error', message: message(e) })
        // Nothing to close: the next press or toggle starts fresh.
        if (take === t) take = null
        return false
      },
    )
    take = t
  }

  async function end() {
    const t = take
    if (!t || t.ending) return
    t.ending = true
    try {
      if (!(await t.opened)) return
      show({ kind: 'transcribing' })
      const text = await deps.client.stop()
      if (!text) return show({ kind: 'note', text: 'no speech heard' }, true)
      const landed = await deps.insert(t.target, text)
      show({ kind: 'done', text, landed }, true)
    } catch (e) {
      show({ kind: 'error', message: message(e) })
    } finally {
      if (take === t) take = null
      // The model is ready or its download failed; either way no bar should linger.
      store.setState({ download: null })
    }
  }

  return {
    store,
    begin,
    end,
    async toggle() {
      if (take) return end()
      begin()
    },
    note: (text) => show({ kind: 'note', text }, true),
    progress: ({ downloaded, total }) => store.setState({ download: total > 0 && downloaded < total ? downloaded / total : null }),
    lost: () => void end(),
    dismiss() {
      if (store.getState().phase.kind === 'error') show({ kind: 'idle' })
    },
  }
}

export const LANGUAGES: Language[] = ['pt', 'en', 'auto']

/** How each language reads in the Settings window. */
export const LANGUAGE_NAMES: Record<Language, string> = {
  pt: 'Portuguese',
  en: 'English',
  auto: 'Any',
}

/** The language dictation starts on: the one saved, else the first of the system's preferred
 *  languages that is Portuguese or English. `auto` only when neither is among them: whisper's
 *  detection picks among 99 languages and gets a short take wrong more often than not (#325). */
export function firstLanguage(saved: string | null, preferred: readonly string[]): Language {
  if (saved && (LANGUAGES as string[]).includes(saved)) return saved as Language
  for (const tag of preferred) {
    const primary = tag.toLowerCase().split(/[-_]/)[0]
    if (primary === 'pt' || primary === 'en') return primary
  }
  return 'auto'
}
