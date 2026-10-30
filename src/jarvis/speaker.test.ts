import { describe, expect, test } from 'vitest'
import { readReply } from './brain'
import { createSpeaker } from './speaker'
import { forSpeech, REST_IN_PANEL, SPOKEN_MAX } from './speech'

/** A reply streamed in `pieces`: what the speaker said while it came, and what `rest` left. */
function stream(pieces: string[]) {
  const said: string[] = []
  const speaker = createSpeaker((sentence) => said.push(sentence))
  for (const piece of pieces) speaker.push(piece)
  return { said, rest: speaker.rest(readReply(pieces.join('')).words) }
}

/** Every way to cut `reply` in two, and the reply a character at a time. */
const splits = (reply: string) => [...Array.from({ length: reply.length + 1 }, (_, i) => [reply.slice(0, i), reply.slice(i)]), [...reply]]

/** All the loop says aloud: each sentence, then the rest, each through `forSpeech`. */
const heard = ({ said, rest }: { said: string[]; rest: string }) => [...said, rest].filter((t) => t.trim()).map(forSpeech).join(' ')

const LONG = Array.from({ length: 8 }, (_, i) => `Esta é a frase número ${i + 1} de uma resposta longa e cheia de palavras.`).join(' ')

/** Each reply, what is said while it streams, and what is left once it is whole. */
const REPLIES: [string, string[], string][] = [
  ['Tem dois PRs abertos. O 524 está verde.', ['Tem dois PRs abertos.'], 'O 524 está verde.'],
  ['Vou olhar. {"tool": "git_status", "args": {"project": "tasklist"}}', ['Vou olhar.'], ''],
  ['Vou ver o status.\n```json\n{"tool": "git_status", "args": {}}\n```', ['Vou ver o status.'], ''],
  [
    'Deixa eu abrir. <function_calls><invoke name="read_file"><parameter name="path">Nota. Outra.</parameter></invoke></function_calls>',
    ['Deixa eu abrir.'],
    '',
  ],
  ['Certo, um momento {"tool": "web_search", "args": {"query": "dólar hoje. Agora. Já"}}', [], 'Certo, um momento'],
  ['Pronto. Já está.\n{"tool": "open_app", "args": {"name": "Notas. App"}}', ['Pronto.', 'Já está.'], ''],
  [
    'Saiu a v2.1 às 7h38. Levou 1.5 minuto. O último é o PR 524. Ele está verde.',
    ['Saiu a v2.1 às 7h38.', 'Levou 1.5 minuto.', 'O último é o PR 524.'],
    'Ele está verde.',
  ],
  ['O Sr. Silva pediu isso. Falei com a Dra. Ana. Pronto.', ['O Sr. Silva pediu isso.', 'Falei com a Dra. Ana.'], 'Pronto.'],
  ['Quem escreveu foi J. Silva. Tem um prazo, p.ex. Sexta. Ok.', ['Quem escreveu foi J. Silva.', 'Tem um prazo, p.ex. Sexta.'], 'Ok.'],
  ['Faltam duas coisas:\n1. Corrigir o build\n2. Subir a versão\nOs dois são rápidos.', ['Faltam duas coisas:', '1. Corrigir o build', '2. Subir a versão'], 'Os dois são rápidos.'],
  ['Tentei... mas falhou. Vou de novo!', ['Tentei... mas falhou.'], 'Vou de novo!'],
  ['Quer que eu abra? Posso abrir agora.', ['Quer que eu abra?'], 'Posso abrir agora.'],
  ['Se x < 3, roda. Senão, para.', ['Se x < 3, roda.'], 'Senão, para.'],
  ['Rodei isto:\n```\npnpm test. Passou.\n```\nTudo verde. Pode subir.', ['Rodei isto:'], '```\npnpm test. Passou.\n```\nTudo verde. Pode subir.'],
  ['Rode `pnpm test` antes. Depois suba.', ['Rode `pnpm test` antes.'], 'Depois suba.'],
  ['Ele disse "pronto." Depois saiu.', ['Ele disse "pronto."'], 'Depois saiu.'],
  [LONG, [...LONG.split(/(?<=\.) /).slice(0, 4), REST_IN_PANEL], ''],
]

describe('createSpeaker', () => {
  test.each(REPLIES)('%j is said the same however it is split', (reply, said, rest) => {
    for (const pieces of splits(reply)) expect([pieces, stream(pieces)]).toEqual([pieces, { said, rest }])
  })

  test.each(REPLIES)('%j is heard as forSpeech heard it whole, only sooner', (reply) => {
    expect(heard(stream([reply]))).toBe(forSpeech(readReply(reply).words))
  })

  test('a sentence is said as soon as what follows shows it ended', () => {
    const said: string[] = []
    const speaker = createSpeaker((sentence) => said.push(sentence))
    speaker.push('Tem dois PRs abertos.')
    speaker.push(' ')
    // "abertos. o…" would go on: only the next letter tells.
    expect(said).toEqual([])
    speaker.push('O')
    expect(said).toEqual(['Tem dois PRs abertos.'])
    speaker.push(' 524 está verde\n')
    expect(said).toEqual(['Tem dois PRs abertos.', 'O 524 está verde'])
    expect(speaker.rest('Tem dois PRs abertos. O 524 está verde')).toBe('')
  })

  test('a reply of one sentence is left whole to rest, as before', () => {
    expect(stream(['Está limpo.'])).toEqual({ said: [], rest: 'Está limpo.' })
  })

  test('nothing is said twice when the words are not what was streamed', () => {
    const said: string[] = []
    const speaker = createSpeaker((sentence) => said.push(sentence))
    speaker.push('Tem dois PRs. O 524 está verde.')
    expect(said).toEqual(['Tem dois PRs.'])
    expect(speaker.rest('Outra resposta. Bem diferente.')).toBe('')
  })

  test('past SPOKEN_MAX the rest is in the panel, said once, whether the cut comes while streaming or in rest', () => {
    const sentences = LONG.split(/(?<=\.) /)
    // Four sentences said early, the fifth and on known only once the reply is whole.
    const late = stream([sentences.slice(0, 5).join(' ')])
    expect(late.said).toEqual(sentences.slice(0, 4))
    expect(late.rest).toBe(REST_IN_PANEL)
    // The same when the last sentence has no stop.
    expect(stream([sentences.slice(0, 5).join(' ').replace(/\.$/, '')]).rest).toBe(REST_IN_PANEL)
    expect([...late.said, late.rest].join(' ').length).toBeLessThanOrEqual(SPOKEN_MAX + REST_IN_PANEL.length + 1)
    // A first sentence too long is said, and forSpeech cuts it; nothing more is said after it.
    const huge = `${'palavra '.repeat(60)}fim. Depois mais. E mais.`
    const first = stream([huge])
    expect(first.said).toEqual([huge.slice(0, huge.indexOf('fim.') + 4)])
    expect(first.rest).toBe('')
    expect(heard(first)).toBe(forSpeech(huge))
  })
})
