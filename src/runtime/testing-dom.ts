// Rendering for the runtime's component tests, as the repo's other tests do it: React's own
// `act` and a root in the document.

import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

export { act }

const mounted: { root: Root; container: HTMLElement }[] = []

/** Draws `node` in the document. `rerender` draws another in its place. */
export function render(node: ReactNode) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const entry = { root, container }
  mounted.push(entry)
  act(() => root.render(node))
  return {
    container,
    rerender: (next: ReactNode) => act(() => root.render(next)),
    unmount() {
      const at = mounted.indexOf(entry)
      if (at < 0) return
      mounted.splice(at, 1)
      act(() => root.unmount())
      container.remove()
    },
  }
}

/** What a hook answers, read at each render. */
export function renderHook<T>(hook: () => T) {
  const result = { current: undefined as T }
  function Probe() {
    result.current = hook()
    return null
  }
  const r = render(createElement(Probe))
  return { result, unmount: r.unmount }
}

/** Takes everything drawn out of the document. */
export function cleanup() {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount())
    container.remove()
  }
}

/** The element whose text is exactly `text`. */
export function byText(text: string): HTMLElement {
  const hit = [...document.querySelectorAll<HTMLElement>('body *')].find((el) => el.childElementCount === 0 && el.textContent?.trim() === text)
  if (!hit) throw new Error(`nothing says "${text}"`)
  return hit
}

export const byLabel = (label: string): HTMLElement => {
  const hit = document.querySelector<HTMLElement>(`[aria-label="${label}"]`)
  if (!hit) throw new Error(`nothing is labelled "${label}"`)
  return hit
}
