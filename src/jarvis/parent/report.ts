import { sentences } from './follow'
import type { ParentEvent } from './index'

/** What James does when a parent he opened says something (jarvis-parent-report, #503), so the
 *  maintainer hears how a task they handed off ended without asking. `say`: a sentence or two said
 *  aloud at a quiet moment, when the parent was asked for aloud; null when nothing is said. `tell`:
 *  what the brain is told with the next request, so "e aí, o que ele achou?" has an answer. */
export type ParentReport = { say: string | null; tell: string }

/** What is said aloud of a parent's message or question at most, characters: two sentences of a
 *  report, about ten seconds of speech. */
export const SAY_MAX = 280
/** What of the request the brain is reminded of, characters: enough to know which task it was. */
const REQUEST_MAX = 120

const quote = (s: string, n: number) => `«${s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s}»`

/** The report of `e`; null when there is none. A turn's end and a question or a permission prompt
 *  are said, since the maintainer would otherwise have to ask, and only they can answer a prompt;
 *  an exit is told only. Repeats never reach here: `./follow` does not say them twice. */
export function reportOf(e: ParentEvent): ParentReport | null {
  const who = `O parent do ${e.parent.project}`
  const asked = `pedido ${quote(e.parent.request, REQUEST_MAX)}`
  switch (e.kind) {
    case 'opened':
      return null
    case 'turn-ended': {
      if (e.last === '') return { say: `${who} terminou a vez sem dizer nada.`, tell: `${who} (${asked}) terminou a vez sem dizer nada.` }
      const lead = e.last ? sentences(e.last, 2, SAY_MAX) : e.summary
      const tell = e.last
        ? `${who} (${asked}) terminou a vez. A última mensagem dele:\n${e.last}`
        : `${who} (${asked}) terminou a vez: ${e.summary}`
      return { say: `${who} terminou: ${lead}`, tell }
    }
    case 'asking':
      return {
        say: `${who} pergunta: ${sentences(e.question, 2, SAY_MAX)}`,
        tell: `${who} (${asked}) parou numa pergunta e espera a resposta do usuário: ${e.question}`,
      }
    case 'approval':
      return {
        say: `${who} pede aprovação: ${sentences(e.question, 2, SAY_MAX)}`,
        tell: `${who} (${asked}) espera o usuário aprovar ou negar, no painel: ${e.question}`,
      }
    case 'exited':
      return { say: null, tell: `${who} (${asked}) encerrou.` }
  }
}
