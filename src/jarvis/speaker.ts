/** Speaking a reply of the brain while Claude is still writing it (jarvis-speaker, #503). The loop
 *  makes one speaker per brain message and hands it every piece `jarvis_brain_stream` sends; the
 *  speaker says each sentence once it is whole, through `say`, which turns it into speech
 *  (`forSpeech`) and queues it after what is already queued. A tool call the brain writes after its
 *  words (a JSON line, or its own markup, as `readReply` reads them) is never said. Once the reply
 *  is whole, `rest` is what of its words is still to be said: the loop says that, and ends there.
 *
 *  What is heard is what `forSpeech` made of the whole reply before, only sooner: the same words,
 *  and past `SPOKEN_MAX` the same cut at a sentence end, with `REST_IN_PANEL` said once. */

import { forSpeech, REST_IN_PANEL, SPOKEN_MAX } from './speech'

export type Speaker = {
  /** The next piece of the reply, as Claude wrote it. */
  push(piece: string): void
  /** The reply is whole, and `words` are its words as `readReply` read them (the call left out):
   *  what of them is still to be said, '' when all of it was. */
  rest(words: string): string
}

const STOPS = '.!?…'
/** What may close a sentence after its stop: «Ele disse "pronto." Depois…». */
const CLOSERS = `"'»”’)]`
/** Claude's tool-use markup, as `readReply` reads it. */
const MARKUP = ['<function_calls>', '</function_calls>', '<invoke ']
/** Words a period follows without ending the sentence: "o Sr. Silva", "a Dra. Ana". */
const ABBREVIATIONS = new Set(
  ['sr', 'sra', 'srta', 'dr', 'dra', 'prof', 'profa', 'eng', 'av', 'ex', 'vs', 'pág', 'p', 'nº', 'no', 'mr', 'mrs', 'ms', 'st', 'jr', 'inc', 'ltda', 'cia', 'aprox', 'etc'],
)

/** Where a call may start, at or after `from`: the first `{`, fence or markup. Nothing from there
 *  on is said before the reply is whole. A start the next piece may complete ("``", "<inv") holds
 *  nothing: it is at the end, and no sentence ends after it yet. */
function held(text: string, from: number): number {
  const starts = ['{', '```', ...MARKUP].map((start) => text.indexOf(start, from)).filter((at) => at >= 0)
  return Math.min(text.length, ...starts)
}

/** Whether the period at `stop` follows an abbreviation, an initial ("J. Silva") or a list's
 *  number at the start of a line ("1. Corrigir o build"). */
function abbreviated(text: string, stop: number): boolean {
  let start = stop
  while (start > 0 && !/\s/.test(text[start - 1])) start--
  const word = text.slice(start, stop).replace(/^[(«"“'‘[]+/, '')
  if (ABBREVIATIONS.has(word.toLowerCase()) || /^[A-Z]$/.test(word) || /^(?:\p{L}{1,3}\.)+\p{L}{1,3}$/u.test(word)) return true
  return /^\d+$/.test(word) && /(?:^|\n)[ \t]*$/.test(text.slice(0, start))
}

/** The end of the sentence starting at `from`, its stop before `limit`; -1 when it is not known
 *  yet. A stop ends it when a space and then anything but a lowercase letter follow ("1.5", "v2.1"
 *  and "Tentei... mas" go on), and a line break always does. `whole`: nothing more will come. */
function sentenceEnd(text: string, from: number, limit: number, whole: boolean): number {
  for (let i = from; i < limit; i++) {
    if (text[i] === '\n') {
      if (text.slice(from, i).trim()) return i
      continue
    }
    if (!STOPS.includes(text[i])) continue
    let end = i
    while (end < text.length && STOPS.includes(text[end])) end++
    while (end < text.length && CLOSERS.includes(text[end])) end++
    let next = end
    while (next < text.length && (text[next] === ' ' || text[next] === '\t')) next++
    if (next === text.length) return whole ? end : -1
    if (text[next] === '\n') return end
    if (next > end && !/\p{Ll}/u.test(text[next]) && !(text[i] === '.' && abbreviated(text, i))) return end
    i = end - 1
  }
  return -1
}

/** What of `words` comes after `said`, spaces aside; '' when `said` is not where `words` start,
 *  so that nothing is said twice. */
function after(words: string, said: string): string {
  let i = 0
  for (const c of said) {
    if (/\s/.test(c)) continue
    while (i < words.length && /\s/.test(words[i])) i++
    if (words[i] !== c) return ''
    i++
  }
  return words.slice(i).trim()
}

export function createSpeaker(say: (sentence: string) => void): Speaker {
  let text = ''
  /** Where what is not said yet starts in `text`. */
  let said = 0
  /** How long what was said is, as `forSpeech` has it, with a space between sentences. */
  let spoken = 0
  /** The cut came: `REST_IN_PANEL` was said, and nothing more is. */
  let cut = false
  /** The length `sentence` brings what was said to, as `forSpeech` has it; null when that passes
   *  `SPOKEN_MAX`. A first sentence is said however long: `forSpeech` cuts that one itself. */
  const fits = (sentence: string) => {
    const aloud = forSpeech(sentence)
    if (!aloud) return spoken
    const length = spoken ? spoken + 1 + aloud.length : aloud.length
    return spoken && (length > SPOKEN_MAX || aloud.endsWith(REST_IN_PANEL)) ? null : length
  }
  /** Whether `forSpeech` cut a first sentence and said `REST_IN_PANEL` for it. */
  const over = (sentence: string) => forSpeech(sentence).endsWith(` ${REST_IN_PANEL}`)

  return {
    push(piece) {
      text += piece
      if (cut) return
      const limit = held(text, said)
      for (let end = sentenceEnd(text, said, limit, false); end >= 0; end = sentenceEnd(text, said, limit, false)) {
        const sentence = text.slice(said, end).trim()
        said = end
        const length = fits(sentence)
        if (length === null) {
          cut = true
          return say(REST_IN_PANEL)
        }
        if (length === spoken) continue
        say(sentence)
        if (!spoken && over(sentence)) cut = true
        spoken = length
        if (cut) return
      }
    },
    rest(words) {
      const left = cut ? '' : after(words, text.slice(0, said))
      if (!spoken || !left) return left
      let taken = 0
      for (let end = sentenceEnd(left, 0, left.length, true); end >= 0; end = sentenceEnd(left, taken, left.length, true)) {
        const length = fits(left.slice(taken, end))
        if (length === null) return `${left.slice(0, taken).trim()} ${REST_IN_PANEL}`.trim()
        spoken = length
        taken = end
      }
      // The last sentence, which no stop ends.
      return fits(left.slice(taken)) === null ? `${left.slice(0, taken).trim()} ${REST_IN_PANEL}`.trim() : left
    },
  }
}
