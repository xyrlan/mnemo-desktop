import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { actionForKey } from '../actions/keys'
import { drive, parseKeys, toJson } from './drive'

afterEach(() => {
  document.body.innerHTML = ''
})

function mount(html: string) {
  document.body.innerHTML = html
}

describe('click', () => {
  it('sends the pointer and mouse sequence, focuses, and says what it hit', async () => {
    mount('<button id="go" class="primary big">Save   now</button>')
    const seen: string[] = []
    const btn = document.getElementById('go')!
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      btn.addEventListener(t, (e) => seen.push(`${e.type}:${(e as MouseEvent).button}`))
    }
    const r = await drive({ action: 'click', selector: '#go' })
    expect(seen).toEqual(['pointerdown:0', 'mousedown:0', 'pointerup:0', 'mouseup:0', 'click:0'])
    expect(r).toEqual({ ok: true, result: { element: '<button#go.primary.big>', text: 'Save now', focused: true } })
  })

  it('focuses the focusable ancestor of what it clicks', async () => {
    mount('<a href="#x" id="link"><span id="inner">go</span></a>')
    await drive({ action: 'click', selector: '#inner' })
    expect(document.activeElement?.id).toBe('link')
  })

  it('does not focus when pointerdown is taken', async () => {
    mount('<button id="b">b</button>')
    document.getElementById('b')!.addEventListener('pointerdown', (e) => e.preventDefault())
    await drive({ action: 'click', selector: '#b' })
    expect(document.activeElement).toBe(document.body)
  })

  it('refuses missing, invalid and disabled targets without throwing', async () => {
    mount('<button id="off" disabled>x</button>')
    expect(await drive({ action: 'click', selector: '#nope' })).toEqual({ ok: false, error: 'no element matches "#nope"' })
    expect(await drive({ action: 'click', selector: '##' })).toEqual({ ok: false, error: '"##" is not a valid CSS selector' })
    expect(await drive({ action: 'click', selector: '#off' })).toEqual({ ok: false, error: '<button#off> is disabled' })
    expect(await drive({ action: 'click' })).toEqual({ ok: false, error: '`selector` is required for click' })
  })
})

describe('type', () => {
  it('drives a controlled React input through its onChange', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const changes: string[] = []
    function Field() {
      const [v, setV] = useState('ab')
      return (
        <input
          id="f"
          value={v}
          onChange={(e) => {
            changes.push(e.target.value)
            setV(e.target.value)
          }}
        />
      )
    }
    const root = createRoot(container)
    await act(async () => root.render(<Field />))
    let r: Awaited<ReturnType<typeof drive>> | undefined
    await act(async () => {
      r = await drive({ action: 'type', selector: '#f', text: 'cd' })
    })
    expect(changes).toEqual(['abcd'])
    expect((document.getElementById('f') as HTMLInputElement).value).toBe('abcd')
    expect(r).toEqual({ ok: true, result: { element: '<input#f>', value: 'abcd', focused: true } })
    act(() => root.unmount())
  })

  it('inserts at the caret of the focused field and fires an insertText input event', async () => {
    mount('<textarea id="t">hello world</textarea>')
    const t = document.getElementById('t') as HTMLTextAreaElement
    t.focus()
    t.setSelectionRange(5, 5)
    const events: InputEvent[] = []
    t.addEventListener('input', (e) => events.push(e as InputEvent))
    await drive({ action: 'type', text: ',' })
    expect(t.value).toBe('hello, world')
    expect(t.selectionStart).toBe(6)
    expect(events.map((e) => [e.inputType, e.data])).toEqual([['insertText', ',']])
  })

  it('never echoes a password back', async () => {
    mount('<input id="p" type="password">')
    const r = await drive({ action: 'type', selector: '#p', text: 'secret' })
    expect(JSON.stringify(r)).not.toContain('secret')
    expect((document.getElementById('p') as HTMLInputElement).value).toBe('secret')
  })

  it('refuses what takes no text', async () => {
    mount('<button id="b">b</button><input id="c" type="checkbox">')
    expect((await drive({ action: 'type', selector: '#b', text: 'x' })).error).toMatch(/<button#b> does not take text/)
    expect((await drive({ action: 'type', selector: '#c', text: 'x' })).error).toMatch(/does not take text/)
    ;(document.activeElement as HTMLElement).blur()
    expect((await drive({ action: 'type', text: 'x' })).error).toMatch(/<body> does not take text/)
    expect((await drive({ action: 'type', selector: '#b' })).error).toBe('`text` is required for type')
    expect((await drive({ action: 'type', selector: '#b', text: 3 })).error).toBe('`text` must be a string')
  })
})

describe('parseKeys', () => {
  it('reads chords, sequences and aliases', () => {
    expect(parseKeys('Meta+k', true)).toEqual([{ key: 'k', code: 'KeyK', keyCode: 75, meta: true, ctrl: false, alt: false, shift: false }])
    expect(parseKeys('cmd+shift+d', true)[0]).toMatchObject({ key: 'D', code: 'KeyD', meta: true, shift: true })
    expect(parseKeys('Mod+t', false)[0]).toMatchObject({ ctrl: true, meta: false })
    expect(parseKeys('Mod+t', true)[0]).toMatchObject({ ctrl: false, meta: true })
    expect(parseKeys('down Down  Enter esc Space').map((c) => [c.key, c.keyCode])).toEqual([
      ['ArrowDown', 40],
      ['ArrowDown', 40],
      ['Enter', 13],
      ['Escape', 27],
      [' ', 32],
    ])
    expect(parseKeys('Ctrl+Alt+ArrowLeft')[0]).toMatchObject({ key: 'ArrowLeft', ctrl: true, alt: true })
    expect(parseKeys('F5 1 Shift+[')[0]).toMatchObject({ key: 'F5', keyCode: 116 })
    expect(parseKeys('F5 1 Shift+[')[1]).toMatchObject({ key: '1', code: 'Digit1', keyCode: 49 })
    expect(parseKeys('F5 1 Shift+[')[2]).toMatchObject({ key: '[', code: 'BracketLeft', shift: true })
    expect(parseKeys('Meta++')[0]).toMatchObject({ key: '+', meta: true })
    expect(parseKeys('+')[0]).toMatchObject({ key: '+', meta: false })
  })

  it('names what it cannot read', () => {
    expect(() => parseKeys('  ')).toThrow(/names no key/)
    expect(() => parseKeys('Hyper+k')).toThrow(/"Hyper" in "Hyper\+k" is not a modifier/)
    expect(() => parseKeys('Meta+Enterr')).toThrow(/"Enterr" is not a key/)
    expect(() => parseKeys('Meta+')).toThrow(/not a key chord/)
  })
})

describe('key', () => {
  it('reaches the app chords the way a real ⌘K does', async () => {
    const got: (string | null)[] = []
    const onKey = (e: KeyboardEvent) => got.push(actionForKey(e, 'mac'))
    window.addEventListener('keydown', onKey, true)
    try {
      expect(await drive({ action: 'key', keys: 'Meta+k Meta+Shift+d Meta+Alt+ArrowLeft' })).toMatchObject({ ok: true })
    } finally {
      window.removeEventListener('keydown', onKey, true)
    }
    expect(got).toEqual(['palette.open', 'pane.split.col', 'focus.left'])
  })

  it('carries the legacy key codes xterm reads', async () => {
    mount('<textarea id="t"></textarea>')
    const seen: string[] = []
    const t = document.getElementById('t')!
    for (const type of ['keydown', 'keypress', 'keyup']) {
      t.addEventListener(type, (e) => {
        const k = e as KeyboardEvent
        seen.push(`${k.type}:${k.key}:${k.keyCode}:${k.which}:${k.charCode}`)
      })
    }
    await drive({ action: 'key', selector: '#t', keys: 'Enter A' })
    expect(seen).toEqual(['keydown:Enter:13:13:0', 'keyup:Enter:13:13:0', 'keydown:a:65:65:0', 'keypress:a:97:97:97', 'keyup:a:65:65:0'])
  })

  it('types a printable key nothing took, and not one something did', async () => {
    mount('<input id="i"><input id="j">')
    await drive({ action: 'key', selector: '#i', keys: 'h i Shift+x Meta+a' })
    expect((document.getElementById('i') as HTMLInputElement).value).toBe('hiX')

    const j = document.getElementById('j') as HTMLInputElement
    j.addEventListener('keydown', (e) => e.key === 'q' && e.preventDefault())
    j.addEventListener('keypress', (e) => e.key === 'w' && e.preventDefault())
    await drive({ action: 'key', selector: '#j', keys: 'q w e' })
    expect(j.value).toBe('e')
  })

  it('goes to the focused element without a selector', async () => {
    mount('<input id="i">')
    const i = document.getElementById('i') as HTMLInputElement
    i.focus()
    const spy = vi.fn()
    i.addEventListener('keydown', spy)
    await drive({ action: 'key', keys: 'Escape' })
    expect(spy).toHaveBeenCalledOnce()
  })
})

describe('eval', () => {
  it('takes an expression or a body, and awaits it', async () => {
    document.title = 'mnemo'
    expect(await drive({ action: 'eval', js: 'document.title' })).toEqual({ ok: true, result: 'mnemo' })
    expect(await drive({ action: 'eval', js: 'document.title;' })).toEqual({ ok: true, result: 'mnemo' })
    expect(await drive({ action: 'eval', js: 'const n = 2; return n * 21' })).toEqual({ ok: true, result: 42 })
    expect(await drive({ action: 'eval', js: 'new Promise((r) => setTimeout(() => r({ a: [1] }), 1))' })).toEqual({ ok: true, result: { a: [1] } })
    expect(await drive({ action: 'eval', js: 'await Promise.resolve(7)' })).toEqual({ ok: true, result: 7 })
    expect(await drive({ action: 'eval', js: 'void 0' })).toEqual({ ok: true })
  })

  it('reports what the script threw', async () => {
    expect(await drive({ action: 'eval', js: 'throw new Error("boom")' })).toEqual({ ok: false, error: 'boom' })
    expect(await drive({ action: 'eval', js: 'nope(' })).toMatchObject({ ok: false })
    expect(await drive({ action: 'eval', js: '' })).toEqual({ ok: false, error: '`js` must not be empty' })
  })

  it('brings back what JSON cannot carry as something readable', () => {
    mount('<div id="d" class="a b"></div>')
    const loop: Record<string, unknown> = { n: 1 }
    loop.self = loop
    expect(
      toJson({ el: document.getElementById('d'), big: 10n, f: function named() {}, m: new Map([['k', 1]]), s: new Set([1]), e: new TypeError('x'), loop, u: undefined }),
    ).toEqual({ el: '<div#d.a.b>', big: '10', f: '[function named]', m: { k: 1 }, s: [1], e: { name: 'TypeError', message: 'x' }, loop: { n: 1, self: '[repeated]' } })
    expect(toJson(undefined)).toBeUndefined()
  })
})

it('refuses an unknown action', async () => {
  expect(await drive({ action: 'hover' })).toEqual({ ok: false, error: '`action` must be one of click, type, key, eval (got "hover")' })
  expect(await drive({})).toMatchObject({ ok: false })
})
