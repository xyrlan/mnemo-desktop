/** The orb's page (`orb.html`, #506): none of the app, only the orb on a canvas, the word for what
 *  James is doing, and the caption. It hears `jarvis://orb` from the main window (`./control`)
 *  and the voice's `jarvis://level`, and draws while a conversation is on or fading; once faded,
 *  nothing runs. A frame is drawn only when it would differ from the last. */
import '@fontsource-variable/geist'
import '@fontsource-variable/jura'
import { emitTo, listen } from '@tauri-apps/api/event'
import { alphaOf } from './caption'
import { frame } from './draw'
import { LINGER_MS, LOOK_WORD, ORB_EVENT, ORB_READY, type Caption, type OrbLook, type OrbState } from './show'

/** `jarvis://level` (src/jarvis/client.ts's `VoiceLevel`, which this page does not import). */
type VoiceLevel = { mic: number; out: number }

const canvas = document.getElementById('orb') as HTMLCanvasElement
const word = document.getElementById('state') as HTMLDivElement
const caption = document.getElementById('caption') as HTMLDivElement
const ctx = canvas.getContext('2d')!

let look: OrbLook | null = null
let captions: Caption[] = []
let fadingFrom: number | null = null
let target: VoiceLevel = { mic: 0, out: 0 }
let level = 0
let running = false
/** The frame's motion switch, as the main window last said it. */
let switched = false

const system = (() => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)')
  } catch {
    return null
  }
})()
/** Nothing may turn or swell: the frame's switch, or the system, says so. */
const still = () => switched || (system?.matches ?? false)

const size = () => {
  const css = canvas.clientWidth
  const px = Math.round(css * devicePixelRatio)
  if (canvas.width !== px) canvas.width = canvas.height = px
  return px
}

/** What the caption last showed, so the page is touched only when it changes. */
let captioned = ''
const drawCaptions = (now: number, alpha: number) => {
  const shown = captions.map((c) => ({ c, opacity: (alpha * alphaOf(c, captions, now)).toFixed(2) }))
  const key = JSON.stringify(shown.map(({ c, opacity }) => [c.who, c.text, opacity]))
  if (key === captioned) return
  captioned = key
  caption.replaceChildren(
    ...shown.map(({ c, opacity }) => {
      const el = document.createElement('div')
      el.className = c.who
      el.textContent = c.text
      el.style.opacity = opacity
      return el
    }),
  )
}

/** The orb's own opacity: whole while a look is on, then fading out over `LINGER_MS`. */
const orbAlpha = (now: number) => (fadingFrom === null ? 1 : Math.max(0, 1 - (now - fadingFrom) / LINGER_MS))

/** The look last shown, drawn while the orb fades out. */
let last: OrbLook = 'waiting'
/** A hairline orb reads as smooth at 30 frames a second, at a fraction of the display's rate. */
const FRAME_MS = 1000 / 30
let drawn = -Infinity
/** What the canvas last showed, while the orb holds still: the same again is not drawn. */
let held = ''
const tick = (t: number) => {
  if (t - drawn < FRAME_MS - 2) {
    requestAnimationFrame(tick)
    return
  }
  drawn = t
  const now = Date.now()
  const alpha = orbAlpha(now)
  const want = look === 'listening' ? target.mic : look === 'speaking' ? target.out : 0
  // Quick to rise, slower to fall, so a syllable shows and the orb does not flicker.
  level += (want - level) * (want > level ? 0.35 : 0.12)
  if (look) last = look
  const px = size()
  const holding = still()
  const key = holding ? `${look ?? last} ${level.toFixed(2)} ${alpha.toFixed(2)} ${px}` : ''
  if (!holding || key !== held) frame(ctx, px, { look: look ?? last, level, alpha, still: holding }, t)
  held = key
  word.style.opacity = alpha.toFixed(2)
  drawCaptions(now, alpha)
  if (!look && alpha <= 0) {
    running = false
    return
  }
  requestAnimationFrame(tick)
}
const run = () => {
  if (running) return
  running = true
  requestAnimationFrame(tick)
}

const listening = [listen<OrbState>(ORB_EVENT, ({ payload }) => {
  captions = payload.captions
  switched = payload.still === true
  if (payload.look) {
    look = payload.look
    word.textContent = LOOK_WORD[look]
    word.dataset.look = look
    fadingFrom = null
    run()
  } else if (look) {
    look = null
    fadingFrom = Date.now()
    run()
  }
}),
listen<VoiceLevel>('jarvis://level', ({ payload }) => {
  target = payload
})]
// Made on its first show, the page may miss the first state: it asks for it once it listens.
void Promise.all(listening).then(() => emitTo('main', ORB_READY))
