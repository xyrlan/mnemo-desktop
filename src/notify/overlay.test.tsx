import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { frameStilled, stilled, useOverlayRoot, useStilled } from './overlay'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** The system's preference, as a media query a test can flip. */
const system = {
  matches: false,
  heard: new Set<() => void>(),
  set(matches: boolean) {
    this.matches = matches
    for (const fn of [...this.heard]) fn()
  },
}

let host: HTMLElement
let root: Root
let frame: HTMLElement

beforeEach(() => {
  system.matches = false
  system.heard.clear()
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return system.matches && query === '(prefers-reduced-motion: reduce)'
    },
    addEventListener: (_: string, fn: () => void) => void system.heard.add(fn),
    removeEventListener: (_: string, fn: () => void) => void system.heard.delete(fn),
  }))
  // The frame's root, as `src/frame/Frame.tsx` draws it.
  frame = document.body.appendChild(document.createElement('div'))
  frame.className = 'mn'
  frame.dataset.view = 'console'
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

function Overlay() {
  const moving = !useStilled()
  return (
    <div {...useOverlayRoot('thing')} data-testid="overlay">
      {moving ? 'moving' : 'still'}
    </div>
  )
}
const overlay = () => host.querySelector<HTMLElement>('[data-testid="overlay"]')!

test("an overlay's root wears the identity beside its own name", () => {
  act(() => root.render(<Overlay />))
  expect(overlay().className).toBe('mn thing')
  expect(overlay().hasAttribute('data-motion')).toBe(false)
  expect(overlay().textContent).toBe('moving')
})

test("the frame's switch stills an overlay, when it is turned and when it was already on", async () => {
  act(() => root.render(<Overlay />))
  await act(async () => frame.setAttribute('data-motion', 'reduced'))
  expect(overlay().getAttribute('data-motion')).toBe('reduced')
  expect(overlay().textContent).toBe('still')
  expect(frameStilled()).toBe(true)

  await act(async () => frame.removeAttribute('data-motion'))
  expect(overlay().hasAttribute('data-motion')).toBe(false)
  expect(overlay().textContent).toBe('moving')

  // Mounted after the switch was turned.
  act(() => root.render(<></>))
  frame.setAttribute('data-motion', 'reduced')
  act(() => root.render(<Overlay />))
  expect(overlay().getAttribute('data-motion')).toBe('reduced')
})

test('an overlay that is stilled does not still the others: only the frame is read', async () => {
  // Another overlay's root, carrying the switch it was handed. It is no frame: it has no view.
  const other = document.body.appendChild(document.createElement('div'))
  other.className = 'mn note-stack'
  other.dataset.motion = 'reduced'
  act(() => root.render(<Overlay />))
  expect(frameStilled()).toBe(false)
  expect(overlay().hasAttribute('data-motion')).toBe(false)
})

test("the system's preference stills what a stylesheet cannot, and is not the frame's switch", () => {
  act(() => root.render(<Overlay />))
  act(() => system.set(true))
  expect(overlay().textContent).toBe('still')
  expect(stilled()).toBe(true)
  // The root says only what the frame's switch says: the system's preference is a media query's.
  expect(overlay().hasAttribute('data-motion')).toBe(false)
  act(() => system.set(false))
  expect(overlay().textContent).toBe('moving')
})

test('unmounted, an overlay hears nothing more', () => {
  act(() => root.render(<Overlay />))
  expect(system.heard.size).toBeGreaterThan(0)
  act(() => root.render(<></>))
  expect(system.heard.size).toBe(0)
})
