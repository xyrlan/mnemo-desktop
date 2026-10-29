import type { ParentEvent } from './index'

/** What James does when a parent he opened says something (jarvis-parent-report, #503), so the
 *  maintainer hears how a task they handed off ended without asking. `say`: a sentence or two said
 *  aloud at a quiet moment, when the parent was asked for aloud; null when nothing is said. `tell`:
 *  what the brain is told with the next request, so "e aí, o que ele achou?" has an answer. */
export type ParentReport = { say: string | null; tell: string }

/** The report of `e`; null when there is none. The seam's tells the brain what the panel shows and
 *  says nothing. */
export function reportOf(e: ParentEvent): ParentReport | null {
  switch (e.kind) {
    case 'opened':
      return null
    case 'turn-ended':
      return { say: null, tell: `O parent do ${e.parent.project} terminou a vez: ${e.summary}` }
    case 'asking':
      return { say: null, tell: `O parent do ${e.parent.project} pergunta: ${e.question}` }
    case 'approval':
      return { say: null, tell: `O parent do ${e.parent.project} espera aprovação: ${e.question}` }
    case 'exited':
      return { say: null, tell: `O parent do ${e.parent.project} encerrou.` }
  }
}
