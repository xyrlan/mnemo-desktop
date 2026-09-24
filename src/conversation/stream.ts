import { parseRecord } from './parse'
import type { Card, Chunk, Conversation, FollowEvent, SessionStatus, StatusMarker, TranscriptRecord } from './types'

/** How many lines the first send and each "load earlier" ask for (spec Q16). */
export const TAIL = 200

/** One followed transcript. A `/clear` in the pane starts a new one below the last, which stays
 *  on screen frozen. `start`/`end` are the byte range of `records` in the file; `start` is null
 *  until the first lines arrive (and again after a `Reset`). `gen` counts resets, so a "load
 *  earlier" that was in flight across one is dropped. */
export type Segment = {
  key: number
  sessionId: string
  records: TranscriptRecord[]
  start: number | null
  end: number
  state: 'loading' | 'missing' | 'live' | 'error'
  error: string | null
  gen: number
  loadingEarlier: boolean
  earlierError: string | null
}

export type Pending = 'permission' | 'question'

/** One row of the virtualised list. `key` is stable across re-derivations (a card id prefixed by
 *  its segment), so a row's expanded state and scroll anchor survive new lines. */
export type Item =
  | { kind: 'card'; key: string; card: Card; pending: Pending | null }
  | { kind: 'clear'; key: string }
  | { kind: 'marker'; key: string; marker: StatusMarker; carried?: true }
  | { kind: 'earlier'; key: string; segment: number; loading: boolean }
  | { kind: 'note'; key: string; text: string }

export const newSegment = (key: number, sessionId: string): Segment => ({
  key,
  sessionId,
  records: [],
  start: null,
  end: 0,
  state: 'loading',
  error: null,
  gen: 0,
  loadingEarlier: false,
  earlierError: null,
})

const records = (lines: string[]) => lines.map(parseRecord).filter((r): r is TranscriptRecord => r !== null)

/** `seg` after one event of its follow. */
export function applyEvent(seg: Segment, e: FollowEvent): Segment {
  switch (e.kind) {
    case 'lines':
      return { ...seg, records: seg.records.concat(records(e.lines)), start: seg.start ?? e.start, end: e.end, state: 'live', error: null }
    case 'reset':
      return { ...newSegment(seg.key, seg.sessionId), gen: seg.gen + 1 }
    case 'missing':
      return seg.records.length ? seg : { ...seg, state: 'missing' }
  }
}

/** `seg` with the earlier `chunk` in front, unless it was reset or moved since it was asked
 *  for before byte `before` in generation `gen`. */
export function applyEarlier(seg: Segment, chunk: Chunk, gen: number, before: number): Segment {
  if (seg.gen !== gen || seg.start !== before) return { ...seg, loadingEarlier: false }
  return { ...seg, records: records(chunk.lines).concat(seg.records), start: chunk.start, loadingEarlier: false, earlierError: null }
}

/** The tool call a waiting session is parked on: the first one with no result since the last
 *  prompt typed. An AskUserQuestion always reads as a question, whatever kind the caller
 *  guessed: `claude agents` says only that the session waits, not on what. */
export function pendingCard(cards: Card[], waiting: SessionStatus['waiting']): { id: string; kind: Pending } | null {
  if (!waiting) return null
  let from = 0
  for (let i = cards.length - 1; i >= 0; i--) {
    const c = cards[i]
    if (c.kind === 'user' && !c.queued) {
      from = i + 1
      break
    }
  }
  for (let i = from; i < cards.length; i++) {
    const c = cards[i]
    if (c.kind === 'tool' && c.outcome === null) return { id: c.id, kind: c.name === 'AskUserQuestion' || waiting === 'question' ? 'question' : 'permission' }
  }
  return null
}

const time = (at: string) => {
  const t = Date.parse(at)
  return Number.isNaN(t) ? null : t
}

/** `a` is before `b`: by time when both parse, else as strings (ISO sorts as text). */
const before = (a: string, b: string) => {
  const ta = time(a)
  const tb = time(b)
  return ta !== null && tb !== null ? ta < tb : a < b
}

/** Every row of the stream, top to bottom: each segment's cards (a `/clear` divider between
 *  segments, a "load earlier" row atop a later segment that does not start at its file's top),
 *  `markers` merged in by time, and the pending card marked in the last segment.
 *
 *  Markers older than a segment's first card, when the segment's window starts partway into its
 *  file, belong among records not loaded yet: shown, they would all stack above the first card.
 *  Only the newest of them is kept, as the state the window opens in (`carried`); the others come
 *  back in place once "load earlier" reads their records, as every marker is merged afresh. */
export function streamItems(segments: Segment[], conversations: Conversation[], markers: StatusMarker[], status: SessionStatus | undefined): Item[] {
  const items: Item[] = []
  const left = [...markers].sort((a, b) => (before(a.at, b.at) ? -1 : before(b.at, a.at) ? 1 : 0))
  const seen = new Map<string, number>()
  let m = 0
  const flush = (upTo: string | null, carry = false) => {
    const from = m
    while (m < left.length && (upTo === null || before(left[m].at, upTo))) m++
    for (let j = carry ? Math.max(from, m - 1) : from; j < m; j++) {
      // Keyed by what it says, not its index: a marker added earlier in time moves no other. A
      // carried one gets a key of its own, so the row that anchors a "load earlier" is a card.
      const base = `${carry ? 'carried' : 'm'}:${left[j].at}:${left[j].label}`
      const n = seen.get(base) ?? 0
      seen.set(base, n + 1)
      const key = n ? `${base}:${n}` : base
      items.push(carry ? { kind: 'marker', key, marker: left[j], carried: true } : { kind: 'marker', key, marker: left[j] })
    }
  }
  segments.forEach((seg, i) => {
    const conv = conversations[i]
    if (i > 0) items.push({ kind: 'clear', key: `clear:${seg.key}` })
    if (i > 0 && seg.start !== null && seg.start > 0) items.push({ kind: 'earlier', key: `earlier:${seg.key}`, segment: seg.key, loading: seg.loadingEarlier })
    const last = i === segments.length - 1
    const pending = last ? pendingCard(conv.cards, status?.waiting ?? null) : null
    const partial = seg.start !== null && seg.start > 0
    for (const [c, card] of conv.cards.entries()) {
      flush(card.at, c === 0 && partial)
      items.push({ kind: 'card', key: `${seg.key}:${card.id}`, card, pending: pending?.id === card.id ? pending.kind : null })
    }
    if (!conv.cards.length) {
      const text =
        seg.state === 'missing' ? 'waiting for the transcript…' : seg.state === 'error' ? `could not read the transcript: ${seg.error}` : seg.state === 'loading' ? 'loading…' : 'nothing in this session yet'
      items.push({ kind: 'note', key: `note:${seg.key}`, text })
    }
  })
  flush(null)
  return items
}

/** How late a busy status can be behind the transcript: the mission snapshot is polled every
 *  3 s, 15 s while the window is hidden. */
export const STATUS_LAG_MS = 15_000

/** When the `working…` row starts counting. The last prompt is the true start when it came
 *  after the session was last known idle (allowing for the status's lag), or when it was never
 *  seen idle (the view opened mid-turn). Otherwise the session got busy on its own (a child
 *  between prompts), and the moment that was seen is the best there is. */
export function workingSince(lastPromptAt: string | null, lastIdleAt: number | null, busySeenAt: number): number {
  const prompt = lastPromptAt ? time(lastPromptAt) : null
  if (prompt !== null && (lastIdleAt === null || prompt >= lastIdleAt - STATUS_LAG_MS)) return Math.min(prompt, busySeenAt)
  return busySeenAt
}

/** `0:42`, `12:03`, `1:02:03`. */
export function clockText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const p = (n: number) => String(n).padStart(2, '0')
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h}:${p(m)}:${p(s % 60)}` : `${m}:${p(s % 60)}`
}

/** The newest prompt of `cards` (typed, or sent by a peer), for `workingSince`. */
export function lastPromptAt(cards: Card[]): string | null {
  for (let i = cards.length - 1; i >= 0; i--) {
    const c = cards[i]
    if ((c.kind === 'user' && !c.queued) || c.kind === 'peer') return c.at
  }
  return null
}

/** Virtuoso's `firstItemIndex` for `items`, given the last render's: rows that appeared above
 *  the old first row (a "load earlier") lower it by as many, so the rows on screen stay put.
 *  When the old first row is gone (a reset replaced everything) it stays where it was. */
export function firstIndex(prev: { items: Item[]; first: number } | null, items: Item[], base: number): number {
  if (!prev || !prev.items.length) return base
  // Anchored on the first old row still there: a carried marker atop the old window is gone
  // (or back in place among the earlier rows) once they load.
  const at = new Map(items.map((it, i) => [it.key, i]))
  for (const [j, it] of prev.items.entries()) {
    const i = at.get(it.key)
    if (i !== undefined) return prev.first + j - i
  }
  return prev.first
}
