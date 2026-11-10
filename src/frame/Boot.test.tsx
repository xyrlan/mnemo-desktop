import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Boot, BOOT_MS, LEAVE_MS, OPEN_MS, boots, bootsNow, placeOf, type BootPhase } from './Boot'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLElement
let phases: (BootPhase | null)[]

/** The clip as the frame holds it: the frame keeps the phase and takes the clip down at null. */
function Held() {
  const [phase, setPhase] = useState<BootPhase | null>('playing')
  phases[phases.length - 1] !== phase && phases.push(phase)
  return <main>{phase && <Boot phase={phase} onPhase={setPhase} />}</main>
}

const clip = () => host.querySelector<HTMLElement>('[data-frame-boot]')
const tick = (ms: number) => act(async () => void vi.advanceTimersByTime(ms))

beforeEach(async () => {
  vi.useFakeTimers()
  sessionStorage.clear()
  localStorage.clear()
  phases = []
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await act(async () => root.render(<Held />))
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

describe('whether a launch plays the clip', () => {
  const calm = { still: false, played: false, off: false }

  test('a launch that opens on Orbit does', () => {
    expect(boots({ view: 'orbit' }, calm)).toBe(true)
  })

  test('a launch that returns to anything but Orbit does not', () => {
    expect(boots({ view: 'console' }, calm)).toBe(false)
    expect(boots({ view: 'score' }, calm)).toBe(false)
  })

  test('reduced motion skips it; so does a reload, and a harness that asked for none', () => {
    expect(boots({ view: 'orbit' }, { ...calm, still: true })).toBe(false)
    expect(boots({ view: 'orbit' }, { ...calm, played: true })).toBe(false)
    expect(boots({ view: 'orbit' }, { ...calm, off: true })).toBe(false)
  })

  test('it plays once per run of the app: the clip marks itself played as it starts', () => {
    // `beforeEach` drew one
    expect(bootsNow({ view: 'orbit' }, false)).toBe(false)
    sessionStorage.clear()
    expect(bootsNow({ view: 'orbit' }, false)).toBe(true)
    localStorage.setItem('mnemo.boot', '0')
    expect(bootsNow({ view: 'orbit' }, false)).toBe(false)
  })
})

describe('where the clip stands', () => {
  const main = { left: 40, top: 80, width: 2000, height: 1000 }

  test('over Orbit’s lattice, at its size, measured from the room’s own corner', () => {
    expect(placeOf(main, { left: 940, top: 480, width: 200, height: 200 })).toEqual({ left: 1000, top: 500, size: 200 })
  })

  test('with no lattice to be found, in the middle of the room', () => {
    expect(placeOf(main, null)).toEqual({ left: 1000, top: 500, size: 240 })
    expect(placeOf(main, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ left: 1000, top: 500, size: 240 })
  })
})

describe('the clip, over its four seconds', () => {
  test('Orbit opens under its last moments, and it is gone when the clip is', async () => {
    expect(clip()!.dataset.frameBoot).toBe('playing')
    await tick(BOOT_MS - OPEN_MS - 1)
    expect(clip()!.dataset.frameBoot).toBe('playing')
    await tick(1)
    expect(clip()!.dataset.frameBoot).toBe('opening')
    await tick(OPEN_MS)
    expect(clip()!.dataset.frameBoot).toBe('leaving')
    await tick(LEAVE_MS)
    expect(clip()).toBeNull()
    expect(phases).toEqual(['playing', 'opening', 'leaving', null])
  })

  test('nothing waits past the clip’s length, even if the clip never says it ended', async () => {
    await tick(BOOT_MS)
    // Orbit is whole from here: only the clip's last frame is still fading from over the lattice
    expect(clip()!.dataset.frameBoot).toBe('leaving')
    expect(BOOT_MS).toBe(4000)
  })

  test('a clip that ends early is left then', async () => {
    await tick(1000)
    await act(async () => void host.querySelector('video')!.dispatchEvent(new Event('ended')))
    expect(clip()!.dataset.frameBoot).toBe('leaving')
    await tick(LEAVE_MS)
    expect(clip()).toBeNull()
  })

  test('a clip that will not play is left at once: no source of it could be read', async () => {
    await act(async () => void host.querySelector('source:last-of-type')!.dispatchEvent(new Event('error')))
    expect(clip()!.dataset.frameBoot).toBe('leaving')
  })

  test('any key skips it, and the key still does what it would have done', async () => {
    const got: string[] = []
    const hear = (e: KeyboardEvent) => void got.push(`${e.key}${e.defaultPrevented ? ' (prevented)' : ''}`)
    window.addEventListener('keydown', hear)
    await act(async () => void document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true, cancelable: true })))
    window.removeEventListener('keydown', hear)
    expect(clip()!.dataset.frameBoot).toBe('leaving')
    expect(got).toEqual(['c'])
    await tick(LEAVE_MS)
    expect(clip()).toBeNull()
  })

  test('a modifier on its own is not a key: Alt on the way to a chord does not skip it', async () => {
    await act(async () => void document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', bubbles: true })))
    expect(clip()!.dataset.frameBoot).toBe('playing')
  })

  test('a click skips it', async () => {
    await act(async () => void document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })))
    expect(clip()!.dataset.frameBoot).toBe('leaving')
  })

  test('skipped while Orbit was opening, it does not start over', async () => {
    await tick(BOOT_MS - OPEN_MS)
    await act(async () => void document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })))
    await tick(LEAVE_MS)
    expect(clip()).toBeNull()
    await tick(BOOT_MS)
    expect(phases).toEqual(['playing', 'opening', 'leaving', null])
  })

  test('it is the generated clip, both encodings, with its last frame as the poster', () => {
    const video = host.querySelector('video')!
    expect([...video.querySelectorAll('source')].map((s) => s.type)).toEqual(['video/webm', 'video/mp4'])
    expect(video.getAttribute('poster')).toMatch(/boot-last\.jpg/)
    expect(video.muted || video.hasAttribute('muted')).toBe(true)
  })
})
