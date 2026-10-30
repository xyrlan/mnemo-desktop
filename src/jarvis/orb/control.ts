/** The orb's side in the main window (#503, #506): it follows the store (the voice's phase, a
 *  request being worked on, the lines), shows and hides the orb's window through `jarvis_orb`, and
 *  sends the orb what only this window knows as `jarvis://orb`. The voice's own events, levels
 *  included, reach the orb's page directly. */
import type { JarvisStore, Line } from '../store'
import { captionsOf } from './caption'
import { HIDDEN, LINGER_MS, lookOf, stepShow, type OrbState, type Shown } from './show'

export type OrbApi = {
  /** `jarvis_orb_enabled() -> Result<bool, String>`: the config's `voice.orb`, on unless `false`. */
  enabled(): Promise<boolean>
  /** `jarvis_orb(show: bool) -> Result<(), String>`. */
  show(show: boolean): Promise<void>
  /** Emits `jarvis://orb` to the orb's window. */
  send(state: OrbState): Promise<void>
  /** `jarvis://orb-ready`: the orb's page has just loaded and wants the current state. */
  onReady(cb: () => void): Promise<() => void>
}

export type OrbDeps = {
  store: JarvisStore
  api: OrbApi
  /** What James says aloud of a reply (`forSpeech`). */
  spoken: (text: string) => string
  now?: () => number
  setTimer?: (f: () => void, ms: number) => unknown
  clearTimer?: (t: unknown) => void
}

export type OrbControl = {
  /** Whether a take opens the panel: only when there is no orb to show it (#506). */
  opensPanel(): boolean
  dispose(): void
}

export function createOrbControl({
  store,
  api,
  spoken,
  now = Date.now,
  setTimer = (f, ms) => setTimeout(f, ms),
  clearTimer = (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
}: OrbDeps): OrbControl {
  // Off until the config is read: a take opens the panel, as it did before the orb.
  let enabled = false
  let shown: Shown = HIDDEN
  let sent = ''
  let timer: unknown

  const update = () => {
    if (!enabled) return
    const s = store.getState()
    // A typed request is answered in the panel it was typed in: James working on it is no
    // conversation for the orb. A spoken one is, whichever way it came.
    let asked: Line | undefined
    for (let i = s.lines.length - 1; i >= 0 && !asked; i--) if (s.lines[i].who === 'you') asked = s.lines[i]
    const look = lookOf(s.voice, s.busy && asked?.who === 'you' && asked.spoken)
    const was = shown
    shown = stepShow(shown, look, now())
    if (shown.shown && !was.shown) void api.show(true).catch(() => {})
    if (!shown.shown && was.shown) {
      void api.show(false).catch(() => {})
      sent = ''
    }
    if (timer !== undefined && shown.overAt === null) {
      clearTimer(timer)
      timer = undefined
    }
    if (shown.overAt !== null && timer === undefined) {
      timer = setTimer(() => {
        timer = undefined
        update()
      }, shown.overAt + LINGER_MS - now())
    }
    if (!shown.shown) return
    const state: OrbState = { look, captions: captionsOf(s.lines, shown.since, spoken) }
    const json = JSON.stringify(state)
    if (json === sent) return
    sent = json
    void api.send(state).catch(() => {})
  }

  let disposed = false
  void api
    .enabled()
    .then((on) => {
      if (disposed) return
      enabled = on
      update()
    })
    .catch(() => {})
  const unsubscribe = store.subscribe(update)
  const unlistenReady = api
    .onReady(() => {
      sent = ''
      update()
    })
    .catch(() => undefined)

  return {
    opensPanel: () => !enabled,
    dispose() {
      disposed = true
      unsubscribe()
      void unlistenReady.then((u) => u?.())
      if (timer !== undefined) clearTimer(timer)
      if (shown.shown) void api.show(false).catch(() => {})
    },
  }
}
