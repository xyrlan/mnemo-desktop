import { invoke } from '@tauri-apps/api/core'
import { listen as tauriListen } from '@tauri-apps/api/event'
import { actionForChord, boundActions, chordFor, detectPlatform, type Chord, type Platform } from './chords'
import { run } from './registry'

export { detectPlatform, type Platform } from './chords'

/** The action a keydown runs, from the chord table (`./chords`). Off a Mac no chord is plain
 *  Ctrl, which is the shell's, and none holds Ctrl with Alt, which is how AltGr arrives. */
export function actionForKey(e: KeyboardEvent, platform: Platform): string | null {
  return actionForChord(e, platform)
}

export type ListKey = 'up' | 'down' | 'open' | 'reply' | 'attach' | 'close'

/** Plain keys a focused list pane (the cockpit inbox) acts on: ↑↓ move, Enter opens the row's
 *  action, `r` reply, `a` attach, Esc closes what the list opened. Never with a modifier (those
 *  are `actionForKey`'s), never while typing, and no Enter on a button or link, which runs
 *  itself. */
export function listKey(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'target'>): ListKey | null {
  if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return null
  const t = e.target as { tagName?: string; isContentEditable?: boolean } | null
  const tag = t?.tagName?.toUpperCase() ?? ''
  if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT' || t?.isContentEditable) return null
  const k = e.key.toLowerCase()
  if (k === 'enter' && (tag === 'BUTTON' || tag === 'A')) return null
  const m: Record<string, ListKey> = { arrowup: 'up', arrowdown: 'down', enter: 'open', r: 'reply', a: 'attach', escape: 'close' }
  return m[k] ?? null
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

export type PageChord = Chord & { id: string }

/** Every chord with its action, as `src-tauri/src/browser_keys.rs` matches a key pressed in a
 *  browser pane against it. */
export function pageChords(platform: Platform): PageChord[] {
  return boundActions().flatMap((id) => {
    const c = chordFor(id, platform)
    return c ? [{ id, ...c }] : []
  })
}

const sendToHost = (chords: PageChord[]) => invoke('browser_chords', { chords })

export function installKeys(
  platform: Platform = detectPlatform(),
  {
    listen = listenPayload,
    runAction = run,
    sendChords = sendToHost,
  }: { listen?: Listen; runAction?: (id: string) => void; sendChords?: (chords: PageChord[]) => Promise<unknown> } = {},
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
  // A browser pane is a webview of its own, out of this handler's reach. On a Mac the native
  // menu carries the chords past it (lib.rs); on Windows the host takes them from the page by
  // this table, and they come back as `app://action` like the menu's.
  if (platform !== 'mac') {
    try {
      void sendChords(pageChords(platform)).catch(() => {})
    } catch {
      // Outside Tauri there is no host to tell.
    }
  }
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
