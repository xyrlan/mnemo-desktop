import { afterEach, describe, expect, test } from 'vitest'
import { browserKey, installNotAPage, keepsContextMenu } from './not-a-page'

const key = (k: string, o: Partial<Pick<KeyboardEvent, 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>> = {}) => ({
  key: k,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...o,
})

describe('browserKey', () => {
  test("WebView2's reload, find, print, save, source, caret and history keys", () => {
    for (const e of [
      key('F5'), key('F5', { ctrlKey: true }), key('F5', { shiftKey: true }), key('r', { ctrlKey: true }), key('R', { ctrlKey: true, shiftKey: true }),
      key('f', { ctrlKey: true }), key('F3'), key('F3', { shiftKey: true }), key('g', { ctrlKey: true }),
      key('p', { ctrlKey: true }), key('s', { ctrlKey: true }), key('u', { ctrlKey: true }), key('F7'),
      key('ArrowLeft', { altKey: true }), key('ArrowRight', { altKey: true }), key('BrowserBack'), key('BrowserRefresh'),
    ]) expect([e, browserKey(e)]).toEqual([e, true])
  })

  test('editing keys, the shell\'s keys and the app\'s chords are left alone', () => {
    for (const e of [
      key('a', { ctrlKey: true }), key('c', { ctrlKey: true }), key('v', { ctrlKey: true }), key('x', { ctrlKey: true }), key('z', { ctrlKey: true }),
      key('w', { ctrlKey: true }), key('d', { ctrlKey: true }), key('k', { ctrlKey: true, shiftKey: true }),
      // AltGr arrives as Ctrl+Alt: Ctrl+Alt+R types a character on some layouts.
      key('r', { ctrlKey: true, altKey: true }), key('f', { ctrlKey: true, altKey: true }),
      key('ArrowLeft', { altKey: true, shiftKey: true }), key('ArrowLeft', { ctrlKey: true }), key('ArrowLeft'),
      key('F1'), key('F12'), key('r'), key('Enter'), key('r', { metaKey: true }),
    ]) expect([e, browserKey(e)]).toEqual([e, false])
  })
})

describe('keepsContextMenu', () => {
  const at = (html: string, selector: string) => {
    document.body.innerHTML = html
    return document.querySelector(selector)
  }

  test('fields, the terminal and selected text keep the webview menu', () => {
    expect(keepsContextMenu(at('<input id=t>', '#t'), '')).toBe(true)
    expect(keepsContextMenu(at('<textarea id=t></textarea>', '#t'), '')).toBe(true)
    expect(keepsContextMenu(at('<div contenteditable="true"><b id=t>x</b></div>', '#t'), '')).toBe(true)
    expect(keepsContextMenu(at('<div class="xterm"><div><canvas id=t></canvas></div></div>', '#t'), '')).toBe(true)
    expect(keepsContextMenu(at('<p id=t>words</p>', '#t'), 'words')).toBe(true)
  })

  test('bare UI does not', () => {
    expect(keepsContextMenu(at('<aside><div id=t></div></aside>', '#t'), '')).toBe(false)
    expect(keepsContextMenu(at('<div contenteditable="false"><b id=t>x</b></div>', '#t'), '  ')).toBe(false)
    expect(keepsContextMenu(null, '')).toBe(false)
  })
})

describe('installNotAPage', () => {
  let off = () => {}
  afterEach(() => {
    off()
    document.body.innerHTML = ''
  })

  // dispatchEvent answers false when a listener cancelled the default.
  const keydown = (target: EventTarget, k: string, o: KeyboardEventInit = {}) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }))
  const menu = (target: EventTarget) => target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))

  test("off a Mac F5 and Ctrl+F do nothing, and bare UI has no browser menu", () => {
    document.body.innerHTML = '<aside id=ui></aside><input id=field><div class="xterm"><textarea id=term></textarea></div>'
    off = installNotAPage('other')
    const ui = document.getElementById('ui')!
    expect(keydown(ui, 'F5')).toBe(false)
    expect(keydown(ui, 'f', { ctrlKey: true })).toBe(false)
    expect(keydown(ui, 'c', { ctrlKey: true })).toBe(true)
    expect(menu(ui)).toBe(false)
    expect(menu(document.getElementById('field')!)).toBe(true)
    expect(menu(document.getElementById('term')!)).toBe(true)
  })

  test('the terminal still hears the key first: the default is cancelled after it, not before', () => {
    document.body.innerHTML = '<div class="xterm"><textarea id=term></textarea></div>'
    off = installNotAPage('other')
    const term = document.getElementById('term')!
    const heard: boolean[] = []
    term.addEventListener('keydown', (e) => heard.push(e.defaultPrevented))
    keydown(term, 'r', { ctrlKey: true })
    expect(heard).toEqual([false])
  })

  test('a menu the app draws itself is left to it', () => {
    document.body.innerHTML = '<div id=row></div>'
    off = installNotAPage('other')
    const row = document.getElementById('row')!
    let seen: boolean | null = null
    row.addEventListener('contextmenu', (e) => e.preventDefault())
    window.addEventListener('contextmenu', (e) => (seen = e.defaultPrevented), { once: true })
    expect(menu(row)).toBe(false)
    expect(seen).toBe(true)
  })

  test('a dev build keeps the menu, for Inspect', () => {
    document.body.innerHTML = '<aside id=ui></aside>'
    off = installNotAPage('other', { keepMenu: true })
    expect(menu(document.getElementById('ui')!)).toBe(true)
    expect(keydown(document.getElementById('ui')!, 'F5')).toBe(false)
  })

  test('on a Mac nothing changes', () => {
    document.body.innerHTML = '<aside id=ui></aside>'
    off = installNotAPage('mac')
    const ui = document.getElementById('ui')!
    expect(keydown(ui, 'F5')).toBe(true)
    expect(keydown(ui, 'r', { ctrlKey: true })).toBe(true)
    expect(menu(ui)).toBe(true)
  })
})
