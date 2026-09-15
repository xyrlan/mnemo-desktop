import { macChord } from './keymap'

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
