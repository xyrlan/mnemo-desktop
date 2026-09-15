import { listen as tauriListen } from '@tauri-apps/api/event'
import { run } from './registry'

export type Platform = 'mac' | 'other'

export function actionForKey(e: KeyboardEvent, platform: Platform): string | null {
  const mod = platform === 'mac' ? e.metaKey : e.ctrlKey
  if (!mod) return null
  const k = e.key.toLowerCase()
  if (e.altKey && !e.shiftKey) {
    const m: Record<string, string> = {
      arrowleft: 'focus.left',
      arrowright: 'focus.right',
      arrowup: 'focus.up',
      arrowdown: 'focus.down',
    }
    return m[k] ?? null
  }
  if (e.altKey) return null
  if (e.shiftKey) {
    const m: Record<string, string> = { d: 'pane.split.col', w: 'tab.close', '[': 'tab.prev', '{': 'tab.prev', ']': 'tab.next', '}': 'tab.next' }
    return m[k] ?? null
  }
  if (/^[1-9]$/.test(k)) return `tab.go.${k}`
  const m: Record<string, string> = { t: 'tab.new', d: 'pane.split.row', w: 'pane.close', k: 'palette.open', b: 'mission.toggle-sidebar' }
  return m[k] ?? null
}

export function detectPlatform(): Platform {
  return navigator.platform.toLowerCase().includes('mac') ? 'mac' : 'other'
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
