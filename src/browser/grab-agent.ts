/** The text as Claude Code's input takes it: one bracketed paste, so newlines stay inside the
 *  turn. Control characters other than newline and tab are dropped: page text cannot close
 *  the paste early or press keys. */
export function pasteOf(text: string): string {
  const clean = text.replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
  return `\x1b[200~${clean}\x1b[201~`
}
