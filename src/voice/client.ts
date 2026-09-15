import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export type Language = 'auto' | 'pt' | 'en'
/** First-use model download, in bytes. */
export type Progress = { downloaded: number; total: number }

export interface VoiceClient {
  /** Opens the microphone. */
  start(): Promise<void>
  /** Closes it and resolves with the transcript, empty for silence. */
  stop(): Promise<string>
  setLanguage(language: Language): Promise<void>
  onProgress(cb: (p: Progress) => void): Promise<UnlistenFn>
}

export const tauriVoice: VoiceClient = {
  start: () => invoke('voice_start'),
  stop: () => invoke<string>('voice_stop'),
  setLanguage: (language) => invoke('voice_set_language', { language }),
  onProgress: (cb) => listen<Progress>('voice://progress', (e) => cb(e.payload)),
}
