import { macChord, pasteBytes, terminalChord, terminalKey } from './keymap'

const ev = (key: string, o: Partial<Parameters<typeof macChord>[0]> = {}) => ({ key, metaKey: true, altKey: false, ctrlKey: false, shiftKey: false, ...o })

test('⌘ arrows and backspace become readline bytes', () => {
  expect(macChord(ev('ArrowLeft'))).toEqual({ write: '\x01' })
  expect(macChord(ev('ArrowRight'))).toEqual({ write: '\x05' })
  expect(macChord(ev('Backspace'))).toEqual({ write: '\x15' })
  expect(macChord(ev('Enter'))).toEqual({ write: '\r' })
})

test('Shift+Enter becomes ESC CR so Claude Code inserts a newline', () => {
  expect(macChord(ev('Enter', { metaKey: false, shiftKey: true }))).toEqual({ write: '\x1b\r' })
  expect(macChord(ev('Enter', { metaKey: false }))).toBeNull()
})

test('⌘C/⌘V are clipboard verbs; other chords fall through', () => {
  expect(macChord(ev('c'))).toEqual({ clipboard: 'copy' })
  expect(macChord(ev('v'))).toEqual({ clipboard: 'paste' })
  expect(macChord(ev('k'))).toBeNull()
  expect(macChord(ev('ArrowLeft', { metaKey: false }))).toBeNull()
  expect(macChord(ev('ArrowLeft', { altKey: true }))).toBeNull()
  expect(macChord(ev('ArrowLeft', { ctrlKey: true }))).toBeNull()
})

const clip = (types: string[][], text = '', fail?: 'read' | 'all') => ({
  read: async () => {
    if (fail) throw new Error('denied')
    return types.map((t) => ({ types: t, getType: async () => ({ text: async () => text }) }))
  },
  readText: async () => {
    if (fail === 'all') throw new Error('denied')
    return text
  },
})

test('⌘V with an image on the clipboard sends Ctrl+V so Claude Code reads the clipboard', async () => {
  expect(await pasteBytes(clip([['image/png']]))).toBe('\x16')
  expect(await pasteBytes(clip([['text/plain'], ['image/tiff']], 'caption'))).toBe('\x16')
})

test('⌘V with text pastes the text; an empty clipboard pastes nothing', async () => {
  expect(await pasteBytes(clip([['text/html', 'text/plain']], 'ls -la'))).toBe('ls -la')
  expect(await pasteBytes(clip([['text/plain']], ''))).toBeNull()
  expect(await pasteBytes(clip([], 'never asked'))).toBeNull()
})

test('when read() is refused or missing the text path still works', async () => {
  expect(await pasteBytes(clip([], 'echo hi', 'read'))).toBe('echo hi')
  expect(await pasteBytes({ readText: async () => 'plain' })).toBe('plain')
  expect(await pasteBytes(clip([], '', 'all'))).toBeNull()
})

describe('off a Mac the clipboard is on Ctrl (#329)', () => {
  const key = (k: string, o: Partial<Parameters<typeof macChord>[0]> = {}) => ({ key: k, metaKey: false, altKey: false, ctrlKey: true, shiftKey: false, type: 'keydown', ...o })

  test('Ctrl+C copies a selection, and interrupts when there is none', () => {
    expect(terminalKey(key('c'), 'other', 'picked text')).toEqual({ copy: 'picked text' })
    // Passed on, xterm writes ^C.
    expect(terminalKey(key('c'), 'other', '')).toEqual({ pass: true })
  })

  test('Ctrl+V pastes, by the path ⌘V takes on a Mac (an image included)', () => {
    expect(terminalKey(key('v'), 'other', '')).toEqual({ paste: true })
    expect(terminalKey(key('v', { metaKey: true, ctrlKey: false }), 'mac', '')).toEqual({ paste: true })
  })

  test('Ctrl+Shift+C and Ctrl+Shift+V copy and paste; with nothing selected Ctrl+Shift+C does not interrupt', () => {
    expect(terminalKey(key('C', { shiftKey: true }), 'other', 'picked')).toEqual({ copy: 'picked' })
    expect(terminalKey(key('C', { shiftKey: true }), 'other', '')).toEqual({ drop: true })
    expect(terminalKey(key('V', { shiftKey: true }), 'other', '')).toEqual({ paste: true })
  })

  test('every other Ctrl key is the shell’s', () => {
    for (const k of ['w', 'd', 'k', 'l', 'e', 'n', 'b', 't', 'j', 'a', 'r', 'z', 'x', '1']) expect([k, terminalKey(key(k), 'other', 'picked')]).toEqual([k, { pass: true }])
  })

  test('AltGr, which arrives as Ctrl+Alt, types its letter: no copy, no paste', () => {
    expect(terminalChord(key('c', { altKey: true }), 'other')).toBeNull()
    expect(terminalChord(key('v', { altKey: true }), 'other')).toBeNull()
    expect(terminalKey(key('ć', { altKey: true }), 'other', 'picked')).toEqual({ pass: true })
  })

  test('the Windows key is not ⌘: nothing a Mac binds on ⌘ is read from it', () => {
    for (const k of ['c', 'v', 'ArrowLeft', 'ArrowRight', 'Backspace', 'Enter']) expect([k, terminalChord(key(k, { metaKey: true, ctrlKey: false }), 'other')]).toEqual([k, null])
  })

  test('Shift+Enter is ESC CR there too', () => {
    expect(terminalChord(key('Enter', { ctrlKey: false, shiftKey: true }), 'other')).toEqual({ write: '\x1b\r' })
  })

  test('only a keydown acts', () => {
    expect(terminalKey(key('v', { type: 'keyup' }), 'other', '')).toEqual({ pass: true })
  })
})

test('a Mac reads exactly what macChord reads, and Ctrl+C / Ctrl+V stay the shell’s', () => {
  const mods = Array.from({ length: 16 }, (_, n) => ({ metaKey: !!(n & 1), ctrlKey: !!(n & 2), altKey: !!(n & 4), shiftKey: !!(n & 8) }))
  for (const m of mods)
    for (const k of ['c', 'C', 'v', 'V', 'k', 'w', 'ArrowLeft', 'ArrowRight', 'Backspace', 'Enter']) expect([m, k, terminalChord({ key: k, ...m }, 'mac')]).toEqual([m, k, macChord({ key: k, ...m })])
  const mac = (k: string, o = {}) => ({ key: k, metaKey: true, altKey: false, ctrlKey: false, shiftKey: false, type: 'keydown', ...o })
  expect(terminalKey(mac('c'), 'mac', 'picked')).toEqual({ copy: 'picked' })
  // No selection: ⌘C reaches the shell as nothing, as before.
  expect(terminalKey(mac('c'), 'mac', '')).toEqual({ pass: true })
  expect(terminalKey(mac('C', { shiftKey: true }), 'mac', '')).toEqual({ pass: true })
  expect(terminalKey(mac('ArrowLeft'), 'mac', '')).toEqual({ write: '\x01' })
  expect(terminalKey(mac('c', { metaKey: false, ctrlKey: true }), 'mac', 'picked')).toEqual({ pass: true })
  expect(terminalKey(mac('v', { metaKey: false, ctrlKey: true }), 'mac', '')).toEqual({ pass: true })
  expect(terminalKey(mac('v', { type: 'keyup' }), 'mac', '')).toEqual({ pass: true })
})
