// What the system panels' tests share: a way to draw a panel, press what a person presses, and
// wait for what an answer changes. Not part of the app.

import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
Element.prototype.scrollIntoView ??= () => {}

/** Lets every pending promise and effect land. */
export const flush = (ms = 0) => act(async () => void (await new Promise((r) => setTimeout(r, ms))))

/** Draws `node` in the frame's `.mn` root; the answer unmounts it. */
export async function draw(node: ReactNode): Promise<() => Promise<void>> {
  const host = document.body.appendChild(document.createElement('div'))
  host.className = 'mn'
  const root = createRoot(host)
  await act(async () => root.render(node))
  await flush()
  return async () => {
    await act(async () => root.unmount())
    host.remove()
  }
}

export async function click(el: Element | null | undefined): Promise<void> {
  if (!el) throw new Error('nothing to click')
  await act(async () => void (el as HTMLElement).click())
  await flush()
}

/** The button whose text is `text` (or matches it), or whose `aria-label` is. */
export function button(text: string | RegExp, within: ParentNode = document): HTMLButtonElement | undefined {
  const is = (s: string | null) => s !== null && (typeof text === 'string' ? s.trim() === text : text.test(s))
  return [...within.querySelectorAll('button')].find((b) => is(b.textContent) || is(b.getAttribute('aria-label')))
}

/** A key pressed on `el` (the page when not given); the answer says whether it was prevented. */
export async function key(k: string, el: EventTarget = document.body): Promise<boolean> {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
  await act(async () => void el.dispatchEvent(e))
  await flush()
  return e.defaultPrevented
}

/** Types `value` into a field the way React hears it. */
export async function type(el: Element | null | undefined, value: string): Promise<void> {
  if (!(el instanceof HTMLInputElement)) throw new Error('no field to type in')
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await flush()
}

/** The texts of every element `selector` finds, trimmed. */
export const texts = (selector: string, within: ParentNode = document) => [...within.querySelectorAll(selector)].map((e) => (e.textContent ?? '').trim())
