import { macChord, pasteBytes } from './keymap'

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
