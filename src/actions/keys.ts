import { listen as tauriListen } from '@tauri-apps/api/event'
import { actionForChord, detectPlatform, type Platform } from './chords'
import { run } from './registry'

export { detectPlatform, type Platform } from './chords'

/** The action a keydown runs, from the chord table (`./chords`). Off a Mac no chord is plain
 *  Ctrl, which is the shell's, and none holds Ctrl with Alt, which is how AltGr arrives. */
export function actionForKey(e: KeyboardEvent, platform: Platform): string | null {
  return actionForChord(e, platform)
}

/** The action id carried by an `app://action` event (emitted by the native menu), or null. */
export function actionFromMenu(payload: unknown): string | null {
  const id = (payload as { id?: unknown } | null)?.id
  return typeof id === 'string' && id !== '' ? id : null
}

export type Source = 'key' | 'menu'

/** When the main webview has focus a chord can arrive twice, as a keydown and as a native
 *  menu event. Whichever comes second for the same action within `windowMs` is dropped;
 *  repeats from one source (a held key) always pass. */
export function makeDedupe(windowMs = 50, now: () => number = () => performance.now()) {
  let last: { id: string; source: Source; at: number } | null = null
  return (id: string, source: Source): boolean => {
    const at = now()
    const dup = !!last && last.id === id && last.source !== source && at - last.at < windowMs
    if (!dup) last = { id, source, at }
    return !dup
  }
}

type Listen = <T>(event: string, cb: (payload: T) => void) => Promise<() => void>
const listenPayload: Listen = (event, cb) => tauriListen(event, (e) => cb(e.payload as never))

export function installKeys(
  platform: Platform = detectPlatform(),
  { listen = listenPayload, runAction = run }: { listen?: Listen; runAction?: (id: string) => void } = {},
): () => void {
  const fire = makeDedupe()
  const handler = (e: KeyboardEvent) => {
    const id = actionForKey(e, platform)
    if (!id) return
    e.preventDefault()
    e.stopPropagation()
    if (fire(id, 'key')) runAction(id)
  }
  window.addEventListener('keydown', handler, true)
  // On a Mac the native menu (lib.rs) carries the chords too, as `app://action`.
  // Outside Tauri (plain Vite in a browser) there is no event bus: the keydown path stays.
  let unlisten: Promise<(() => void) | undefined>
  try {
    unlisten = listen<unknown>('app://action', (payload) => {
      const id = actionFromMenu(payload)
      if (id && fire(id, 'menu')) runAction(id)
    }).catch(() => undefined)
  } catch {
    unlisten = Promise.resolve(undefined)
  }
  return () => {
    window.removeEventListener('keydown', handler, true)
    void unlisten.then((off) => off?.())
  }
}
