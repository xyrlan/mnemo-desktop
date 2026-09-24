/** `desktop_app_drive`: a session drives the app's own webview — click, type, press keys, run
 *  script — so it can see a change working through `desktop_app_snapshot`. Debug builds only
 *  (the app is full of terminals, and this types into them); `view.tsx` offers it to the tools
 *  only under `import.meta.env.DEV`, and the Rust side refuses it in a release build as well.
 *
 *  The events are synthetic (`isTrusted` is false) and only the default action that matters
 *  most is reproduced: text lands in the focused field. A Tab does not move focus and an Enter
 *  does not submit a form; click the control instead. */

export type DriveAction = 'click' | 'type' | 'key' | 'eval'
export type DriveArgs = { action: DriveAction; selector?: string; text?: string; keys?: string; js?: string }
export type DriveResult = { ok: boolean; result?: unknown; error?: string }

/** Runs one action and never throws: a failure comes back as `{ ok: false, error }`. */
export async function drive(params: Record<string, unknown>, doc: Document = document): Promise<DriveResult> {
  try {
    const result = await run(params, doc)
    return result === undefined ? { ok: true } : { ok: true, result }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

async function run(params: Record<string, unknown>, doc: Document): Promise<unknown> {
  const action = params.action
  switch (action) {
    case 'click': {
      const el = find(doc, str(params, 'selector', true))
      click(el)
      return describe(el)
    }
    case 'type': {
      const text = str(params, 'text', true)
      const el = target(doc, str(params, 'selector'))
      if (!editable(el)) throw new Error(`${label(el)} does not take text; pass the selector of an input, a textarea or an editable element`)
      insertText(el, text)
      return describe(el)
    }
    case 'key': {
      const chords = parseKeys(str(params, 'keys', true))
      const el = target(doc, str(params, 'selector'))
      for (const c of chords) press(el, c)
      return describe(el)
    }
    case 'eval':
      return toJson(await evaluate(str(params, 'js', true)))
    default:
      throw new Error(`\`action\` must be one of click, type, key, eval (got ${JSON.stringify(action)})`)
  }
}

function str(params: Record<string, unknown>, name: string, required: true): string
function str(params: Record<string, unknown>, name: string): string | undefined
function str(params: Record<string, unknown>, name: string, required = false): string | undefined {
  const v = params[name]
  if (v === undefined || v === null) {
    if (required) throw new Error(`\`${name}\` is required for ${String(params.action)}`)
    return undefined
  }
  if (typeof v !== 'string') throw new Error(`\`${name}\` must be a string`)
  if (required && v === '') throw new Error(`\`${name}\` must not be empty`)
  return v
}

function find(doc: Document, selector: string): Element {
  let el: Element | null
  try {
    el = doc.querySelector(selector)
  } catch {
    throw new Error(`${JSON.stringify(selector)} is not a valid CSS selector`)
  }
  if (!el) throw new Error(`no element matches ${JSON.stringify(selector)}`)
  return el
}

/** The element a keystroke goes to: the selector's (focused first), or whatever has focus. */
function target(doc: Document, selector: string | undefined): Element {
  if (selector === undefined) return doc.activeElement ?? doc.body
  const el = find(doc, selector)
  focus(el)
  return el
}

function focus(el: Element) {
  if (el instanceof HTMLElement || el instanceof SVGElement) el.focus({ preventScroll: true })
}

function label(el: Element): string {
  const id = el.id ? `#${el.id}` : ''
  const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).join('.')}` : ''
  return `<${el.tagName.toLowerCase()}${id}${cls}>`
}

/** What the action landed on, so a session can tell it hit the element it meant. */
function describe(el: Element): { element: string; text?: string; value?: string; focused: boolean } {
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
  const shown = el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && el.type !== 'password')
  const value = shown ? (el as Field).value.slice(-120) : undefined
  return {
    element: label(el),
    ...(text ? { text } : {}),
    ...(value !== undefined ? { value } : {}),
    focused: el.ownerDocument.activeElement === el,
  }
}

// ---------------------------------------------------------------------------------------
// click

function click(el: Element) {
  if ((el as HTMLButtonElement).disabled) throw new Error(`${label(el)} is disabled`)
  el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  const r = el.getBoundingClientRect()
  const at = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }
  const base = { bubbles: true, cancelable: true, composed: true, button: 0, view: el.ownerDocument.defaultView, ...at }
  const win = el.ownerDocument.defaultView as (Window & typeof globalThis) | null
  const Pointer = win?.PointerEvent ?? win?.MouseEvent ?? MouseEvent
  const Mouse = win?.MouseEvent ?? MouseEvent
  const pointer = { pointerId: 1, pointerType: 'mouse', isPrimary: true }
  // Radix and friends open on pointerdown, plain handlers on click: send the whole sequence.
  const down = el.dispatchEvent(new Pointer('pointerdown', { ...base, ...pointer, buttons: 1 }))
  const mouseDown = el.dispatchEvent(new Mouse('mousedown', { ...base, buttons: 1 }))
  if (down && mouseDown) focus(focusable(el) ?? el)
  el.dispatchEvent(new Pointer('pointerup', { ...base, ...pointer, buttons: 0 }))
  el.dispatchEvent(new Mouse('mouseup', { ...base, buttons: 0 }))
  el.dispatchEvent(new Mouse('click', { ...base, buttons: 0, detail: 1 }))
}

const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable=""], [contenteditable="true"]'

function focusable(el: Element): Element | null {
  return el.closest(FOCUSABLE)
}

// ---------------------------------------------------------------------------------------
// type

type Field = HTMLInputElement | HTMLTextAreaElement

function field(el: Element): el is Field {
  return el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'image', 'range', 'color'].includes(el.type))
}

function editable(el: Element): boolean {
  return field(el) || (el instanceof HTMLElement && el.isContentEditable)
}

/** Text in at the caret, the way a keyboard puts it: the native `insertText` command when the
 *  engine has it (WebKit does; a controlled React input and xterm's textarea both follow its
 *  `input` event), else the value set through the prototype setter React watches, plus the
 *  same `input` event. */
function insertText(el: Element, text: string) {
  const doc = el.ownerDocument
  if (doc.activeElement !== el) focus(el)
  let done = false
  try {
    done = doc.activeElement === el && doc.execCommand('insertText', false, text)
  } catch {
    done = false
  }
  if (done) return
  if (field(el)) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const set = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    const [start, end] = caret(el)
    const next = el.value.slice(0, start) + text + el.value.slice(end)
    if (set) set.call(el, next)
    else el.value = next
    try {
      el.setSelectionRange(start + text.length, start + text.length)
    } catch {
      // email and number inputs have no selection
    }
  } else {
    el.textContent = (el.textContent ?? '') + text
  }
  const Input = doc.defaultView?.InputEvent ?? InputEvent
  el.dispatchEvent(new Input('input', { bubbles: true, data: text, inputType: 'insertText' }))
}

function caret(el: Field): [number, number] {
  try {
    const len = el.value.length
    return [el.selectionStart ?? len, el.selectionEnd ?? len]
  } catch {
    return [el.value.length, el.value.length]
  }
}

// ---------------------------------------------------------------------------------------
// key

export type Chord = { key: string; code: string; keyCode: number; meta: boolean; ctrl: boolean; alt: boolean; shift: boolean }

const NAMED: Record<string, [key: string, code: string, keyCode: number]> = {
  enter: ['Enter', 'Enter', 13],
  return: ['Enter', 'Enter', 13],
  tab: ['Tab', 'Tab', 9],
  escape: ['Escape', 'Escape', 27],
  esc: ['Escape', 'Escape', 27],
  backspace: ['Backspace', 'Backspace', 8],
  delete: ['Delete', 'Delete', 46],
  del: ['Delete', 'Delete', 46],
  space: [' ', 'Space', 32],
  arrowup: ['ArrowUp', 'ArrowUp', 38],
  up: ['ArrowUp', 'ArrowUp', 38],
  arrowdown: ['ArrowDown', 'ArrowDown', 40],
  down: ['ArrowDown', 'ArrowDown', 40],
  arrowleft: ['ArrowLeft', 'ArrowLeft', 37],
  left: ['ArrowLeft', 'ArrowLeft', 37],
  arrowright: ['ArrowRight', 'ArrowRight', 39],
  right: ['ArrowRight', 'ArrowRight', 39],
  home: ['Home', 'Home', 36],
  end: ['End', 'End', 35],
  pageup: ['PageUp', 'PageUp', 33],
  pagedown: ['PageDown', 'PageDown', 34],
}

/** Punctuation's US-layout key codes, which xterm and older handlers read. */
const PUNCT: Record<string, [code: string, keyCode: number]> = {
  '[': ['BracketLeft', 219],
  ']': ['BracketRight', 221],
  '{': ['BracketLeft', 219],
  '}': ['BracketRight', 221],
  ';': ['Semicolon', 186],
  "'": ['Quote', 222],
  ',': ['Comma', 188],
  '.': ['Period', 190],
  '/': ['Slash', 191],
  '\\': ['Backslash', 220],
  '`': ['Backquote', 192],
  '-': ['Minus', 189],
  '=': ['Equal', 187],
  '+': ['Equal', 187],
}

const MODS: Record<string, 'meta' | 'ctrl' | 'alt' | 'shift' | 'mod'> = {
  meta: 'meta',
  cmd: 'meta',
  command: 'meta',
  '⌘': 'meta',
  super: 'meta',
  ctrl: 'ctrl',
  control: 'ctrl',
  '⌃': 'ctrl',
  alt: 'alt',
  option: 'alt',
  opt: 'alt',
  '⌥': 'alt',
  shift: 'shift',
  '⇧': 'shift',
  mod: 'mod',
  cmdorctrl: 'mod',
  commandorcontrol: 'mod',
}

const isMac = () => typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')

/** `"Meta+k"`, `"Cmd+Shift+D"`, `"ArrowDown ArrowDown Enter"`: chords joined by `+`, pressed
 *  one after another when separated by spaces (`Space` is the space bar). `Mod` is ⌘ on a Mac
 *  and Ctrl elsewhere, like the app's own chords. */
export function parseKeys(keys: string, mac = isMac()): Chord[] {
  const chords = keys.trim().split(/\s+/).filter(Boolean)
  if (chords.length === 0) throw new Error('`keys` names no key')
  return chords.map((c) => parseChord(c, mac))
}

function parseChord(chord: string, mac: boolean): Chord {
  // A trailing `+` is the plus key itself: `Meta++`, or a bare `+`.
  const parts = chord === '+' ? ['+'] : chord.endsWith('++') ? [...chord.slice(0, -2).split('+'), '+'] : chord.split('+')
  if (parts.some((p) => p === '')) throw new Error(`${JSON.stringify(chord)} is not a key chord`)
  const out = { meta: false, ctrl: false, alt: false, shift: false }
  for (const m of parts.slice(0, -1)) {
    const mod = MODS[m.toLowerCase()]
    if (!mod) throw new Error(`${JSON.stringify(m)} in ${JSON.stringify(chord)} is not a modifier (Meta, Ctrl, Alt, Shift, Mod)`)
    out[mod === 'mod' ? (mac ? 'meta' : 'ctrl') : mod] = true
  }
  const last = parts[parts.length - 1]
  const named = NAMED[last.toLowerCase()]
  if (named) return { key: named[0], code: named[1], keyCode: named[2], ...out }
  const fn = /^f([1-9]|1[0-2])$/i.exec(last)
  if (fn) return { key: `F${fn[1]}`, code: `F${fn[1]}`, keyCode: 111 + Number(fn[1]), ...out }
  if ([...last].length !== 1) throw new Error(`${JSON.stringify(last)} is not a key; use one character or a name like Enter, Escape, ArrowDown, Space, F5`)
  if (/^[a-z]$/i.test(last)) {
    const upper = last.toUpperCase()
    return { key: out.shift ? upper : last.toLowerCase(), code: `Key${upper}`, keyCode: upper.charCodeAt(0), ...out }
  }
  if (/^[0-9]$/.test(last)) return { key: last, code: `Digit${last}`, keyCode: last.charCodeAt(0), ...out }
  const p = PUNCT[last]
  return { key: last, code: p?.[0] ?? '', keyCode: p?.[1] ?? 0, ...out }
}

/** keydown, then — for a printable key nothing took — keypress and the text itself, then keyup.
 *  `keyCode`/`which`/`charCode` are set too: xterm reads them, and the event constructor cannot. */
function press(el: Element, c: Chord) {
  const Keyboard = el.ownerDocument.defaultView?.KeyboardEvent ?? KeyboardEvent
  const init = { key: c.key, code: c.code, metaKey: c.meta, ctrlKey: c.ctrl, altKey: c.alt, shiftKey: c.shift, bubbles: true, cancelable: true, composed: true }
  const make = (type: string, keyCode: number, charCode: number) => {
    const e = new Keyboard(type, init)
    Object.defineProperties(e, {
      keyCode: { get: () => keyCode },
      which: { get: () => keyCode || charCode },
      charCode: { get: () => charCode },
    })
    return e
  }
  const printable = [...c.key].length === 1 && !c.meta && !c.ctrl
  const taken = !el.dispatchEvent(make('keydown', c.keyCode, 0))
  if (printable && !taken) {
    const code = c.key.charCodeAt(0)
    const pressTaken = !el.dispatchEvent(make('keypress', code, code))
    if (!pressTaken && editable(el)) insertText(el, c.key)
  }
  el.dispatchEvent(make('keyup', c.keyCode, 0))
}

// ---------------------------------------------------------------------------------------
// eval

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (body: string) => () => Promise<unknown>

/** An expression (`document.title`) or a function body (`const n = 1; return n`), awaited. */
async function evaluate(js: string): Promise<unknown> {
  let fn: () => Promise<unknown>
  try {
    fn = new AsyncFunction(`return (\n${js.trim().replace(/;+$/, '')}\n)`)
  } catch {
    fn = new AsyncFunction(js)
  }
  return fn()
}

/** What survives JSON: elements as their label, an object met twice (a cycle, or shared)
 *  marked the second time, `undefined` dropped. */
export function toJson(v: unknown): unknown {
  if (v === undefined) return undefined
  const seen = new WeakSet<object>()
  const text = JSON.stringify(v, (_k, x: unknown) => {
    if (typeof x === 'bigint') return x.toString()
    if (typeof x === 'function') return `[function ${x.name || 'anonymous'}]`
    if (typeof Element !== 'undefined' && x instanceof Element) return label(x)
    if (x instanceof Map) return Object.fromEntries(x)
    if (x instanceof Set) return [...x]
    if (x instanceof Error) return { name: x.name, message: x.message }
    if (x && typeof x === 'object') {
      if (seen.has(x)) return '[repeated]'
      seen.add(x)
    }
    return x
  })
  return text === undefined ? undefined : JSON.parse(text)
}
