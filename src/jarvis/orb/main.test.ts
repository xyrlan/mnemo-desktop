// The orb's page, run in jsdom: its script is imported once, as `orb.html` loads it, over a page
// with the three elements it draws into. What it would paint is recorded in place of `./draw`,
// frames are stepped by hand, and the tests follow one conversation from its first look to the
// orb fading out, in order.
import { afterAll, beforeAll, expect, test, vi } from 'vitest'
import type { Motion } from './draw'
import { LINGER_MS, ORB_EVENT, ORB_READY, type OrbState } from './show'

const heard = new Map<string, (e: { payload: unknown }) => void>()
const emitted: [string, string][] = []
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (event: string, cb: (e: { payload: unknown }) => void) => {
    heard.set(event, cb)
    return () => {}
  },
  emitTo: async (target: string, event: string) => void emitted.push([target, event]),
}))

const frames: (Motion & { t: number })[] = []
vi.mock('./draw', () => ({ frame: (_ctx: unknown, _size: number, m: Motion, t: number) => void frames.push({ ...m, t }) }))

const T0 = Date.UTC(2026, 10, 10, 12)
let clock = 0
let queue: FrameRequestCallback[] = []
let systemStill = false

/** Lets `ms` pass and runs the frame the page asked for, if it asked for one. */
function step(ms: number): void {
  clock += ms
  vi.setSystemTime(T0 + clock)
  const due = queue
  queue = []
  for (const cb of due) cb(clock)
}
/** `n` frames, one every `ms`. */
const run = (n: number, ms = 40) => {
  for (let i = 0; i < n; i++) step(ms)
}

const orb = (state: OrbState) => heard.get(ORB_EVENT)!({ payload: state })
const level = (mic: number, out: number) => heard.get('jarvis://level')!({ payload: { mic, out } })
const word = () => document.getElementById('state')!
const caption = () => document.getElementById('caption')!

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
  document.body.innerHTML = '<canvas id="orb"></canvas><div id="state"></div><div id="caption"></div>'
  HTMLCanvasElement.prototype.getContext = (() => ({})) as unknown as HTMLCanvasElement['getContext']
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => queue.push(cb))
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return systemStill
    },
  }))
  await import('./main')
  await Promise.resolve()
})

afterAll(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

test('once it listens, it asks the main window for the state it may have missed, and draws nothing yet', () => {
  expect([...heard.keys()].sort()).toEqual([ORB_EVENT, 'jarvis://level'].sort())
  expect(emitted).toEqual([['main', ORB_READY]])
  expect(queue).toEqual([])
  expect(frames).toEqual([])
  expect(word().textContent).toBe('')
})

test('a look puts its word under the orb and starts the frames, thirty a second at most', () => {
  orb({ look: 'listening', captions: [] })
  expect(word().textContent).toBe('listening')
  expect(word().dataset.look).toBe('listening')
  expect(queue).toHaveLength(1)

  step(40)
  expect(frames).toHaveLength(1)
  expect(frames[0]).toMatchObject({ look: 'listening', alpha: 1, still: false })
  // A display that asks for the next frame sooner gets none drawn.
  step(10)
  expect(frames).toHaveLength(1)
  step(30)
  expect(frames).toHaveLength(2)
})

test('it moves with the microphone while listening and with the speaker while speaking: quick to rise, slow to fall', () => {
  level(1, 0.2)
  step(40)
  const first = frames[frames.length - 1].level
  expect(first).toBeGreaterThan(0.3)
  expect(first).toBeLessThan(0.5)
  run(12)
  expect(frames[frames.length - 1].level).toBeGreaterThan(0.95)

  orb({ look: 'speaking', captions: [] })
  expect(word().textContent).toBe('speaking')
  step(40)
  // Towards the speaker's 0.2 now, and falling slower than it rose.
  const fallen = frames[frames.length - 1].level
  expect(fallen).toBeLessThan(0.95)
  expect(fallen).toBeGreaterThan(0.85)
  run(60)
  expect(frames[frames.length - 1].level).toBeCloseTo(0.2, 1)

  // A look that hears nothing settles at rest, whatever the levels say.
  orb({ look: 'thinking', captions: [] })
  run(80)
  expect(frames[frames.length - 1].level).toBeCloseTo(0, 2)
})

test("what was heard and what James says stand under it, and the page is not touched while they do not change", () => {
  const at = T0 + clock
  orb({ look: 'thinking', captions: [{ who: 'you', text: 'como está a fila?', at }] })
  step(40)
  expect([...caption().children].map((el) => [el.className, el.textContent, (el as HTMLElement).style.opacity])).toEqual([['you', 'como está a fila?', '1']])
  const drawn = caption().firstElementChild
  run(5)
  expect(caption().firstElementChild).toBe(drawn)

  orb({ look: 'speaking', captions: [{ who: 'you', text: 'como está a fila?', at }, { who: 'james', text: 'Duas esperam.', at }] })
  step(40)
  // What was heard steps back behind his words.
  expect([...caption().children].map((el) => [el.className, Number((el as HTMLElement).style.opacity)])).toEqual([
    ['you', 0.7],
    ['james', 1],
  ])
})

test("held still by the frame's switch, a frame is drawn only when it would differ", () => {
  orb({ look: 'thinking', captions: [], still: true })
  run(40)
  const before = frames.length
  expect(frames[before - 1]).toMatchObject({ look: 'thinking', still: true })
  // Nothing changes: the frames are still asked for (a level may come), and none is drawn.
  run(10)
  expect(frames).toHaveLength(before)
  expect(queue).toHaveLength(1)

  // The voice is heard: its level is how bright the thread is, so that is drawn.
  orb({ look: 'listening', captions: [], still: true })
  level(0.8, 0)
  step(40)
  const heardAt = frames.length
  expect(heardAt).toBe(before + 1)
  expect(frames[heardAt - 1]).toMatchObject({ look: 'listening', still: true })
  // While the level still rises every frame differs from the last, so each is drawn.
  run(3)
  expect(frames).toHaveLength(heardAt + 3)
  expect(frames[frames.length - 1].level).toBeGreaterThan(frames[heardAt - 1].level)
  // Once it has settled, nothing more is.
  run(60)
  const settled = frames.length
  run(5)
  expect(frames).toHaveLength(settled)

  // The switch turned off: it moves again, every frame.
  orb({ look: 'listening', captions: [] })
  const moving = frames.length
  run(5)
  expect(frames).toHaveLength(moving + 5)
  expect(frames[frames.length - 1].still).toBe(false)
})

test("the system's preference holds it still too, with no switch", () => {
  systemStill = true
  run(40)
  const before = frames.length
  expect(frames[before - 1].still).toBe(true)
  run(5)
  expect(frames).toHaveLength(before)
  systemStill = false
  step(40)
  expect(frames[frames.length - 1].still).toBe(false)
})

test('once the conversation is over the orb fades with its word over the linger, in its last look, and then nothing runs', () => {
  orb({ look: 'speaking', captions: [] })
  step(40)
  orb({ look: null, captions: [] })
  step(LINGER_MS / 2)
  const half = frames[frames.length - 1]
  expect(half.look).toBe('speaking')
  expect(half.alpha).toBeCloseTo(0.5, 1)
  expect(Number(word().style.opacity)).toBeCloseTo(0.5, 1)
  expect(queue).toHaveLength(1)

  step(LINGER_MS)
  expect(frames[frames.length - 1].alpha).toBe(0)
  expect(queue).toEqual([])
  const done = frames.length
  step(1000)
  expect(frames).toHaveLength(done)

  // A new conversation brings it back whole.
  orb({ look: 'listening', captions: [] })
  step(40)
  expect(frames[frames.length - 1]).toMatchObject({ look: 'listening', alpha: 1 })
  expect(Number(word().style.opacity)).toBe(1)
})
