import { afterEach, beforeEach, expect, test } from 'vitest'
import { ARM_SCRIPT, TAKE_SCRIPT, TEARDOWN_SCRIPT } from './grab-guest'
import { parseTake } from './grab-payload'

// The page scripts run here as the child webview runs them: plain script text, evaluated in
// the page's global scope. jsdom lays nothing out, so the element under the pointer is stubbed.

const run = (script: string): unknown => (0, eval)(script)
const take = () => parseTake(run(TAKE_SCRIPT) as string)
const host = () => document.getElementById('__mnemo-grab-host')

let under: Element | null = null
const frames: FrameRequestCallback[] = []

beforeEach(() => {
  document.body.innerHTML = `
    <main>
      <p id="before">Unsaved changes</p>
      <button id="save" class="btn primary" aria-label="Save changes" onclick="evil()" data-x="1">Save</button>
      <input name="password" type="password">
      <a id="docs" href="https://example.com/docs?token=abc#frag">Docs</a>
    </main>`
  under = null
  document.elementFromPoint = () => under
  window.requestAnimationFrame = (cb) => (frames.push(cb), frames.length)
})

afterEach(() => {
  run(TEARDOWN_SCRIPT)
  frames.length = 0
})

function hover(el: Element) {
  under = el
  host()!.dispatchEvent(new MouseEvent('mousemove', { clientX: 5, clientY: 5, bubbles: true }))
  frames.splice(0).forEach((f) => f(0))
}

test('arming lays a full-page click catcher and waits', () => {
  expect(run(ARM_SCRIPT)).toBe(true)
  expect(host()).not.toBeNull()
  expect(host()!.style.cursor).toBe('crosshair')
  expect(take()).toEqual({ kind: 'waiting' })
})

test('a click picks the hovered element, takes the overlay off and is handed over once', () => {
  run(ARM_SCRIPT)
  const save = document.getElementById('save')!
  hover(save)
  const click = new MouseEvent('click', { bubbles: true, cancelable: true })
  host()!.dispatchEvent(click)
  expect(click.defaultPrevented).toBe(true)
  expect(host()).toBeNull()

  const got = take()
  expect(got.kind).toBe('picked')
  if (got.kind !== 'picked') return
  const t = got.payload.target
  expect(t.tagName).toBe('button')
  expect(t.selector).toBe('button#save')
  expect(t.accessibility.accessibleName).toBe('Save changes')
  expect(t.htmlSnippet).toContain('>Save</button>')
  expect(t.textSnippet).toBe('Save')
  // Only safe attributes cross, event handlers never.
  expect(t.attributes).toEqual({ id: 'save', class: 'btn primary', 'aria-label': 'Save changes' })
  expect(got.payload.nearbyText).toContain('Unsaved changes')
  expect(Object.keys(t.computedStyles)).toContain('backgroundColor')

  expect(take()).toEqual({ kind: 'unarmed' })
})

test('a click on nothing picks nothing', () => {
  run(ARM_SCRIPT)
  host()!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  expect(take()).toEqual({ kind: 'waiting' })
  expect(host()).not.toBeNull()
})

test('links lose their query and fragment, secret-looking values are redacted', () => {
  run(ARM_SCRIPT)
  hover(document.getElementById('docs')!)
  host()!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  const got = take()
  if (got.kind !== 'picked') throw new Error(got.kind)
  expect(got.payload.target.attributes.href).toBe('https://example.com/docs')

  run(ARM_SCRIPT)
  hover(document.querySelector('input')!)
  host()!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  const pw = take()
  if (pw.kind !== 'picked') throw new Error(pw.kind)
  expect(pw.payload.target.attributes.name).toBe('[redacted]')
})

test('Escape gives up', () => {
  run(ARM_SCRIPT)
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  expect(host()).toBeNull()
  expect(take()).toEqual({ kind: 'cancelled' })
})

test("arming replaces whatever the page put in the overlay's place", () => {
  let cleaned = false
  ;(window as unknown as { __mnemoGrab: unknown }).__mnemoGrab = {
    take: () => ({ picked: { page: {}, target: { tagName: 'fake' } } }),
    cleanup: () => (cleaned = true),
  }
  run(ARM_SCRIPT)
  expect(cleaned).toBe(true)
  expect(take()).toEqual({ kind: 'waiting' })
})

test('teardown takes the overlay off; a page without one reads as not armed', () => {
  expect(take()).toEqual({ kind: 'unarmed' })
  run(ARM_SCRIPT)
  run(TEARDOWN_SCRIPT)
  expect(host()).toBeNull()
  expect(take()).toEqual({ kind: 'unarmed' })
})
