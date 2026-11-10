import type { Choice, PendingKind, PullRequest } from './types'

/** The keyed list a waiting item is answered with. One habit answers every kind: a digit.
 *  A question's choices are its own; the others are fixed, so the same digit means the same
 *  thing on every card of that kind. */
export function choicesFor(kind: PendingKind, options: { label: string; description?: string | null }[], pr: PullRequest | null): Choice[] {
  const list = (rows: [string, string | null, Choice['tone']][]): Choice[] => rows.map(([label, hint, tone], i) => ({ key: i + 1, label, hint, tone }))
  switch (kind) {
    case 'question':
      return options.map((o, i) => ({ key: i + 1, label: o.label, hint: o.description ?? null, tone: 'neutral' }))
    case 'permission':
      return list([
        ['Allow once', null, 'good'],
        ['Always allow', 'for this session', 'good'],
        ['Deny', null, 'bad'],
      ])
    case 'merge':
      return list([
        [pr?.ci === 'running' ? 'Merge when green' : 'Merge', pr ? `#${pr.number}` : null, 'good'],
        ['Send back', 'say what is missing', 'bad'],
      ])
    case 'stalled':
    case 'blocked':
      return list([
        ['Try again', 'sends "continue"', 'good'],
        ['Stop it', 'ends the session where it stands', 'bad'],
      ])
  }
}
