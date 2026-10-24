/** What James says aloud of a reply (#506). The panel shows the reply whole; the speaker gets it
 *  without what does not read aloud (markdown, code, commit hashes, ids, addresses), and only its
 *  first sentences once it runs long, saying the rest is in the panel. */

/** Past this many characters a spoken reply stops at the end of a sentence. */
export const SPOKEN_MAX = 320
export const REST_IN_PANEL = 'O resto está no painel.'

const FENCE = /```[\s\S]*?(?:```|$)/g
const LINK = /\[([^\]]+)\]\([^)]*\)/g
const URL = /\bhttps?:\/\/[^\s)]+/g
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
/** A commit hash: 7 to 40 hex digits holding a digit and a letter, so neither a year nor a word. */
const HASH = /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/gi
const BULLET = /^\s*(?:[-*•+]|\d+[.)])\s+/
const HEADING = /^\s*#{1,6}\s+/
const SENTENCE_END = /[.!?…]["»”)]*(?=\s|$)/g

/** One line of the reply as words: its markup gone, ended as a sentence. */
function sentence(line: string): string {
  const t = line
    .replace(HEADING, '')
    .replace(BULLET, '')
    .replace(/(\*\*|__|\*|_)(\S(?:.*?\S)?)\1/g, '$2')
    .replace(/`([^`]*)`/g, '$1')
    .trim()
  if (!t) return ''
  return /[.!?…:;,]["»”)]*$/.test(t) ? t.replace(/[:;,]$/, '.') : `${t}.`
}

export function forSpeech(text: string): string {
  const plain = text.replace(FENCE, '\n').replace(LINK, '$1').replace(URL, '').replace(UUID, '').replace(HASH, '')
  let t = plain
    .split('\n')
    .map(sentence)
    .filter(Boolean)
    .join(' ')
    // What the ids and addresses left behind: "()", "( )", "commit :", a space before a stop.
    .replace(/\(\s*\)/g, '')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/([.,;:!?])(?:\s*[.,;:])+/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
  if (t.length <= SPOKEN_MAX) return t
  let cut = 0
  for (const m of t.matchAll(SENTENCE_END)) {
    const end = m.index + m[0].length
    if (end > SPOKEN_MAX) break
    cut = end
  }
  t = cut ? t.slice(0, cut) : `${t.slice(0, t.lastIndexOf(' ', SPOKEN_MAX)).replace(/[.,;:]$/, '')}…`
  return `${t} ${REST_IN_PANEL}`
}
