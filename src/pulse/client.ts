import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { PulseEvent } from './types'

export const PULSE_EVENT = 'mnemo://pulse'

export interface PulseClient {
  /** Starts the Rust tail (idempotent) and calls `onEvent` per event; resolves to an unlisten. */
  connect(onEvent: (e: PulseEvent) => void): Promise<() => void>
}

export const tauriPulse: PulseClient = {
  async connect(onEvent) {
    // Listen first: the tail only reports lines written after it starts anyway.
    const unlisten = await listen<PulseEvent>(PULSE_EVENT, (e) => onEvent(e.payload))
    await invoke('pulse_start')
    return unlisten
  },
}
