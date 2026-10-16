/** The text a dropped voice note becomes (#497), and how outgoing English leaves it alone. No
 *  imports: the mission store reads it too. */

/** The extensions a dropped file is heard under: Ogg Opus, what WhatsApp sends. */
const NOTE = /\.(opus|ogg|oga)$/i

export function isVoiceNote(path: string): boolean {
  return NOTE.test(path)
}

/** The last part of a path, `/` or `\` separated. */
export function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

/** One line of plain text: a control character (a newline among them, which would submit a
 *  terminal's prompt) becomes a space, and runs of space become one. */
function oneLine(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim()
}

const MARK = '[transcript: '

/** What a transcript is typed as: `[transcript: <file name>] <text>`, then a space, as a dropped
 *  path is. One line with no Enter, so nothing is sent: the user adds what to do with it. */
export function transcriptLine(name: string, text: string): string {
  return `${MARK}${oneLine(name).replace(/]/g, ')')}] ${oneLine(text)} `
}

/** `text` with what is not a transcript rewritten by `translate`, for outgoing English: a
 *  transcript is someone else's words, kept verbatim. A transcript runs from its `[transcript: `
 *  to the end of its line; the rest is translated a piece at a time, each keeping its own when its
 *  rewrite fails or comes back empty. With no transcript in it, `text` is translated whole. */
export async function translateAround(text: string, translate: (s: string) => Promise<string>): Promise<string> {
  const own = async (s: string) => {
    const core = s.trim()
    if (!core) return s
    try {
      const t = (await translate(core)).trim()
      if (!t) return s
      // The spacing around a piece stays: it is what joins it to the transcript beside it.
      return s.slice(0, s.indexOf(core)) + t + s.slice(s.indexOf(core) + core.length)
    } catch {
      return s
    }
  }
  if (!text.includes(MARK)) return (await own(text)).trim()
  const pieces: { text: string; keep: boolean }[] = []
  let mine = ''
  for (const line of text.split(/(?<=\n)/)) {
    const at = line.indexOf(MARK)
    if (at < 0) {
      mine += line
      continue
    }
    mine += line.slice(0, at)
    pieces.push({ text: mine, keep: false })
    mine = ''
    pieces.push({ text: line.slice(at), keep: true })
  }
  pieces.push({ text: mine, keep: false })
  const out = await Promise.all(pieces.map((p) => (p.keep ? p.text : own(p.text))))
  return out.join('').trim()
}
