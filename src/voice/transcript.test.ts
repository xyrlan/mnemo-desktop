import { fileName, isVoiceNote, transcriptLine, translateAround } from './transcript'

test('only Ogg Opus extensions are heard, in any case', () => {
  for (const p of ['/a/b.opus', 'C:\\x\\note.OGG', '/a/b.oga']) expect(isVoiceNote(p)).toBe(true)
  for (const p of ['/a/b.mp3', '/a/b.m4a', '/a/b.wav', '/a/opus', '/a/b.opus.txt', '']) expect(isVoiceNote(p)).toBe(false)
})

test('the file name is the last part of a Unix or Windows path', () => {
  expect(fileName('/Users/you/Downloads/WhatsApp Audio 2026-10-16 at 13.59.13.opus')).toBe('WhatsApp Audio 2026-10-16 at 13.59.13.opus')
  expect(fileName('C:\\Users\\you\\note.ogg')).toBe('note.ogg')
})

test('a transcript is one line that submits nothing, its name before it', () => {
  expect(transcriptLine('note.opus', 'Olá, tudo bem?')).toBe('[transcript: note.opus] Olá, tudo bem? ')
  const line = transcriptLine('a\nb.opus', ' one\r\ntwo\nthree\u2028four\x1b[A ')
  expect(line).toBe('[transcript: a b.opus] one two three four [A ')
  expect(line).not.toMatch(/[\r\n\x00-\x1f]/)
  // A bracket in the name would end the mark early.
  expect(transcriptLine('x].opus', 'hi')).toBe('[transcript: x).opus] hi ')
})

const upper = async (s: string) => s.toUpperCase()

test('outgoing English rewrites what the user wrote and leaves a transcript verbatim', async () => {
  expect(await translateAround('resume isso', upper)).toBe('RESUME ISSO')
  expect(await translateAround('[transcript: a.opus] oi tudo bem \nresume isso', upper)).toBe('[transcript: a.opus] oi tudo bem \nRESUME ISSO')
  // Before it on its line, and between two of them.
  expect(await translateAround('veja: [transcript: a.opus] oi \ne [transcript: b.opus] tchau', upper)).toBe('VEJA: [transcript: a.opus] oi \nE [transcript: b.opus] tchau')
  // A transcript alone asks nothing of the translator.
  const asked: string[] = []
  expect(await translateAround('[transcript: a.opus] oi ', async (s) => (asked.push(s), s))).toBe('[transcript: a.opus] oi')
  expect(asked).toEqual([])
})

test('a piece whose rewrite fails or comes back empty keeps its own words', async () => {
  expect(await translateAround('oi', async () => Promise.reject(new Error('down')))).toBe('oi')
  expect(await translateAround('[transcript: a.opus] x\nfaça', async () => '  ')).toBe('[transcript: a.opus] x\nfaça')
})
