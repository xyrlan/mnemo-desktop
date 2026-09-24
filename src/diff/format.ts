import { getDiffCommentLineLabel, type DiffComment } from './comment'

/** Lines of a note's quote shown to the agent at most; the file itself is one read away. */
const QUOTE_LINES = 12

/** The one message a batch of notes goes out as: a line saying what they are, then each note
 *  under its file and lines, the quoted code first. Files keep the order their first note was
 *  written in; a file's notes go top to bottom. */
export function formatDiffComments(comments: readonly DiffComment[]): string {
  const byFile = new Map<string, DiffComment[]>()
  for (const c of [...comments].sort((a, b) => a.createdAt - b.createdAt)) {
    const list = byFile.get(c.filePath) ?? []
    list.push(c)
    byFile.set(c.filePath, list)
  }
  const n = comments.length
  const out = [`Review notes on the uncommitted changes (${n} ${n === 1 ? 'note' : 'notes'}; line numbers are in the working copy):`]
  for (const [file, list] of byFile) {
    list.sort((a, b) => (a.startLine ?? a.lineNumber) - (b.startLine ?? b.lineNumber) || a.lineNumber - b.lineNumber)
    for (const c of list) {
      out.push('')
      out.push(`${file} — ${getDiffCommentLineLabel(c).toLowerCase()}`)
      if (c.quote) {
        const lines = c.quote.split('\n')
        const shown = lines.slice(0, QUOTE_LINES).map((l) => `> ${l}`)
        if (lines.length > QUOTE_LINES) shown.push(`> … (${lines.length - QUOTE_LINES} more lines)`)
        out.push(...shown)
      }
      out.push(c.body)
    }
  }
  return out.join('\n')
}
