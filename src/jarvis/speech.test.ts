import { forSpeech, REST_IN_PANEL, SPOKEN_MAX } from './speech'

test('plain words are said as written', () => {
  expect(forSpeech('Está tudo verde.')).toBe('Está tudo verde.')
  expect(forSpeech('Bom dia! Pode mandar')).toBe('Bom dia! Pode mandar.')
})

test('markdown, code, hashes, ids and addresses are not read aloud', () => {
  expect(forSpeech('O último commit no projeto foi: `c1969a2 2026-10-22 fix(caixa): estorno`.')).toBe('O último commit no projeto foi: 2026-10-22 fix(caixa): estorno.')
  expect(forSpeech('**Sessão 83bfe09d-9f90-42c9-a1b0-607fb99b7f56:** corrigiu o login.')).toBe('Sessão: corrigiu o login.')
  expect(forSpeech('Veja [o PR](https://github.com/you/app/pull/12) ou https://example.com/x.')).toBe('Veja o PR ou.')
  expect(forSpeech('Rode isto:\n```sh\npnpm test\n```\nE depois me diga')).toBe('Rode isto. E depois me diga.')
})

test('a list becomes sentences, and a heading a sentence', () => {
  expect(forSpeech('## Abertos\n- PR 12: corrige o cache\n- PR 14, sobe a versão\n1. issue 3')).toBe('Abertos. PR 12: corrige o cache. PR 14, sobe a versão. issue 3.')
})

test('a year, an issue number and plain words survive the hash rule', () => {
  expect(forSpeech('Em 2026 a issue 792 do decade ficou aberta.')).toBe('Em 2026 a issue 792 do decade ficou aberta.')
})

test('a long reply is cut at a sentence, and says the rest is in the panel', () => {
  const s = 'Esta frase tem umas quarenta letras ok. '
  const long = s.repeat(20).trim()
  const said = forSpeech(long)
  expect(said.endsWith(` ${REST_IN_PANEL}`)).toBe(true)
  const kept = said.slice(0, -REST_IN_PANEL.length - 1)
  expect(kept.length).toBeLessThanOrEqual(SPOKEN_MAX)
  expect(kept.endsWith('ok.')).toBe(true)
  // One run-on sentence is cut at a word.
  const run = forSpeech('palavra '.repeat(80))
  expect(run).toMatch(/palavra… O resto está no painel\.$/)
})
