import { forSpeech } from '../speech'
import type { Line } from '../store'
import { alphaOf, BEHIND, CAPTION_MAX, captionsOf, FADE_MS, HOLD_MS } from './caption'

let id = 0
const you = (at: number, text: string, spoken = true): Line => ({ id: ++id, at, who: 'you', text, spoken })
const james = (at: number, text: string): Line => ({ id: ++id, at, who: 'james', text })
const note = (at: number, text: string): Line => ({ id: ++id, at, who: 'note', text })

test('what was heard comes first, then James’s reply as he says it', () => {
  const lines = [you(100, 'como está o mnemo?'), note(200, 'git_status no mnemo'), james(900, 'Tudo limpo no `main`, commit abc1234f.')]
  expect(captionsOf(lines, 0, forSpeech)).toEqual([
    { who: 'you', text: 'como está o mnemo?', at: 100 },
    { who: 'james', text: 'Tudo limpo no main, commit.', at: 900 },
  ])
})

test('before James answers, only what was heard', () => {
  expect(captionsOf([you(100, 'abre o spotify')], 0, forSpeech)).toEqual([{ who: 'you', text: 'abre o spotify', at: 100 }])
})

test('the last take heard, and only from this conversation', () => {
  const lines = [you(10, 'antes'), james(20, 'Resposta antiga.'), you(5000, 'e agora?'), james(6000, 'Agora sim.')]
  expect(captionsOf(lines, 4000, (t) => t).map((c) => c.text)).toEqual(['e agora?', 'Agora sim.'])
  // A conversation whose take is older than it has no caption.
  expect(captionsOf(lines.slice(0, 2), 4000, (t) => t)).toEqual([])
})

test('a typed request is not a caption: only what was heard', () => {
  expect(captionsOf([you(10, 'digitado', false), james(20, 'Ok.')], 0, (t) => t)).toEqual([])
})

test('a long caption ends in an ellipsis', () => {
  const [c] = captionsOf([you(10, 'a'.repeat(400))], 0, (t) => t)
  expect(c.text).toHaveLength(CAPTION_MAX)
  expect(c.text.endsWith('…')).toBe(true)
})

test('a caption holds, then fades out; what was heard steps back once James answers', () => {
  const heard = { who: 'you' as const, text: 'oi', at: 0 }
  const said = { who: 'james' as const, text: 'Olá.', at: 1000 }
  expect(alphaOf(heard, [heard], HOLD_MS)).toBe(1)
  expect(alphaOf(heard, [heard], HOLD_MS + FADE_MS / 2)).toBeCloseTo(0.5)
  expect(alphaOf(heard, [heard], HOLD_MS + FADE_MS)).toBe(0)
  expect(alphaOf(heard, [heard, said], 500)).toBe(BEHIND)
  expect(alphaOf(said, [heard, said], 1000 + HOLD_MS)).toBe(1)
  expect(alphaOf(said, [heard, said], 1000 + HOLD_MS + FADE_MS * 2)).toBe(0)
})
