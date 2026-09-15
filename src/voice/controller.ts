import { createStore, type StoreApi } from 'zustand/vanilla'
import type { Language, Progress, VoiceClient } from './client'
import type { Target } from './route'

/** What the pill shows. `idle` hides it. */
export type Phase =
  | { kind: 'idle' }
  | { kind: 'listening' }
  | { kind: 'transcribing' }
  | { kind: 'done'; text: string; landed: boolean }
  | { kind: 'note'; text: string }
  | { kind: 'error'; message: string }

export type VoiceState = {
  phase: Phase
  /** Model download fraction while the first-use download runs, else null. */
  download: number | null
}

export type Voice = {
  store: StoreApi<VoiceState>
  /** Opens a take (the chord's press). No-op while one is open. */
  begin(): void
  /** Closes the take, transcribes and inserts (the chord's release). */
  end(): Promise<void>
  /** `voice.dictate` from the palette: begin, or end the open take. */
  toggle(): Promise<void>
  note(text: string): void
  progress(p: Progress): void
}

export type VoiceDeps = {
  client: VoiceClient
  target(): Target
  insert(target: Target, text: string): Promise<boolean>
  /** How long a result stays on the pill, in ms. */
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
  let take: { target: Target; opened: Promise<boolean>; ending: boolean } | null = null

  async function open(): Promise<boolean> {
    try {
      await deps.client.start()
      return true
    } catch (e) {
      // A take left open by a reloaded webview: discard it and try once more.
      if (!message(e).includes('already recording')) throw e
      await deps.client.stop().catch(() => '')
      await deps.client.start()
      return true
    }
  }

  function begin() {
    if (take) return
    const target = deps.target()
    show({ kind: 'listening' })
    const t = { target, opened: Promise.resolve(false), ending: false }
    t.opened = open().catch((e) => {
      show({ kind: 'error', message: message(e) }, true)
      // Nothing to close: the next press or toggle starts fresh.
      if (take === t) take = null
      return false
    })
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
      show({ kind: 'error', message: message(e) }, true)
    } finally {
      if (take === t) take = null
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
  }
}

export const LANGUAGES: Language[] = ['auto', 'pt', 'en']

export function nextLanguage(l: Language): Language {
  return LANGUAGES[(LANGUAGES.indexOf(l) + 1) % LANGUAGES.length]
}
