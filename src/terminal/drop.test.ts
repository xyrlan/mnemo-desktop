import { dropText } from './drop'

test('a plain path is typed as is, with a trailing space', () => {
  expect(dropText(['/Users/me/Desktop/shot.png'])).toBe('/Users/me/Desktop/shot.png ')
})

test('spaces and shell metacharacters are backslash-escaped', () => {
  expect(dropText(['/tmp/Screen Shot 1.png'])).toBe('/tmp/Screen\\ Shot\\ 1.png ')
  expect(dropText(['/tmp/a(1)&$b;*?.png'])).toBe('/tmp/a\\(1\\)\\&\\$b\\;\\*\\?.png ')
  expect(dropText(['/tmp/~x=y'])).toBe('/tmp/\\~x\\=y ')
})

test("a ' or \" in a name is escaped, not quoted around", () => {
  expect(dropText(["/tmp/it's.png"])).toBe("/tmp/it\\'s.png ")
  expect(dropText(['/tmp/say "hi".png'])).toBe('/tmp/say\\ \\"hi\\".png ')
  expect(dropText(['/tmp/back\\slash'])).toBe('/tmp/back\\\\slash ')
})

test('several files are separated by one space each', () => {
  expect(dropText(['/a b.png', '/c.jpg'])).toBe('/a\\ b.png /c.jpg ')
})

test('non-ASCII is left alone; control bytes never reach the PTY raw', () => {
  expect(dropText(['/tmp/Captura de Tela 10.47 PM é.png'])).toBe('/tmp/Captura\\ de\\ Tela\\ 10.47 PM\\ é.png ')
  expect(dropText(['/tmp/a\nb'])).toBe("/tmp/a$'\\x0a'b ")
})

test('nothing dropped types nothing', () => {
  expect(dropText([])).toBe('')
  expect(dropText([''])).toBe('')
})
