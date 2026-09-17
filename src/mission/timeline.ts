import type { TimelineLine } from './types'
import type { Sent } from './store'

/** One row of the mission pane: a run of identical status lines from the child's
 *  `timeline.jsonl`, or a reply that left this app. */
export type Row =
  | { kind: 'status'; state: string; detail: string; lines: StatusLine[]; first: number; last: number; fresh: boolean }
  | { kind: 'you'; sent: Sent; at: number }

/** A timeline line with its epoch ms and its index in the file (what `looked` counts). */
export type StatusLine = TimelineLine & { ms: number; index: number }

/** The child's timeline and the replies sent to it, in one time order, with consecutive
 *  identical `state + detail` lines folded into one row. The two sources are separate
 *  lists: the file says what the child did, `sent` what this app sent it (#82).
 *  `seen` is the timeline length the user had looked at; lines past it are fresh. */
export function timelineRows(lines: TimelineLine[], sent: Sent[], seen: number | undefined): Row[] {
  // A line with no parsable `at` keeps its place in the file, which is written in order.
  let prev = -Infinity
  const status: StatusLine[] = lines.map((l, index) => {
    const t = Date.parse(l.at)
    if (!Number.isNaN(t)) prev = t
    return { ...l, ms: prev, index }
  })
  type Item = { ms: number; line?: StatusLine; sent?: Sent }
  const items: Item[] = [...status.map((line) => ({ ms: line.ms, line })), ...sent.map((s) => ({ ms: s.at, sent: s }))]
  // Stable: equal times keep the file's order, then the replies' order.
  items.sort((a, b) => a.ms - b.ms)

  const rows: Row[] = []
  for (const it of items) {
    if (it.sent) {
      rows.push({ kind: 'you', sent: it.sent, at: it.sent.at })
      continue
    }
    const l = it.line!
    const fresh = seen !== undefined && l.index >= seen
    const tail = rows.at(-1)
    if (tail?.kind === 'status' && tail.state === l.state && tail.detail === l.detail) {
      tail.lines.push(l)
      tail.last = l.ms
      tail.fresh ||= fresh
    } else {
      rows.push({ kind: 'status', state: l.state, detail: l.detail, lines: [l], first: l.ms, last: l.ms, fresh })
    }
  }
  return rows
}

export function clock(ms: number, seconds = true): string {
  if (!Number.isFinite(ms)) return ''
  return new Date(ms).toLocaleTimeString([], seconds ? { hour: '2-digit', minute: '2-digit', second: '2-digit' } : { hour: '2-digit', minute: '2-digit' })
}
