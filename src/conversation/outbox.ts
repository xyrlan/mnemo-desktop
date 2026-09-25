import type { Card } from './types'

/** A message the chat sent, shown at once, before Claude Code writes it into the transcript and
 *  the follow reads it back (a second or more later). `at` is when it was sent (`Date.now()`).
 *  `sending` until the keys are typed, `sent` after, `failed` when nothing was delivered. */
export type Outgoing = {
  id: number
  kind: 'prompt' | 'bash'
  text: string
  at: number
  state: 'sending' | 'sent' | 'failed'
  error?: string
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

/** The words of `card` when it could record `o`: a typed prompt for a prompt, a `!` command for
 *  a shell command. */
function wordsOf(o: Outgoing, card: Card): string | null {
  if (o.kind === 'prompt') return card.kind === 'user' ? card.text : null
  return card.kind === 'command' && card.name === '!' ? card.args : null
}

/** A prompt the chat sends, not a slash command: those Claude Code often records as nothing at
 *  all (`/config`, `/help`), or in another transcript (`/clear`), so a bubble would never go. */
export const showsAsSent = (kind: Outgoing['kind'], text: string) => kind === 'bash' || !text.trimStart().startsWith('/')

/** The messages of `out` the transcript has not recorded yet, in the order sent. `segments` are
 *  the cards of each followed transcript, oldest first. Each record settles one message, never
 *  two, and a message is never shown beside its record: first by its words; then, for one that
 *  was delivered, by the oldest record of its kind made after it (Claude Code rewrote the words:
 *  an image, a long paste). One delivered before a message that is recorded is dropped too: it
 *  never will be. A failed message stays, marked, until the next send. */
export function unsettled(out: Outgoing[], segments: Card[][]): Outgoing[] {
  const live = out.filter((o) => o.state !== 'failed')
  if (!live.length) return out
  // A message's record is written after its keys are typed, on the same clock: only records made
  // since the oldest send can settle anything. Read back from the end, oldest first.
  const since = Math.min(...live.map((o) => o.at))
  const records: { card: Card; at: number }[] = []
  scan: for (let s = segments.length - 1; s >= 0; s--) {
    const cards = segments[s]
    for (let i = cards.length - 1; i >= 0; i--) {
      const at = Date.parse(cards[i].at)
      if (Number.isNaN(at)) continue
      if (at < since) break scan
      records.push({ card: cards[i], at })
    }
  }
  records.reverse()
  const claimed = new Set<number>()
  const settled = new Set<number>()
  const claim = (o: Outgoing, same: boolean) => {
    const i = records.findIndex((r, i) => {
      if (claimed.has(i) || r.at < o.at) return false
      const words = wordsOf(o, r.card)
      return words !== null && (!same || norm(words) === norm(o.text))
    })
    if (i < 0) return
    claimed.add(i)
    settled.add(o.id)
  }
  for (const o of live) claim(o, true)
  for (const o of live) if (o.state === 'sent' && !settled.has(o.id)) claim(o, false)
  if (!settled.size) return out
  // Keys are typed one send after another, so a delivered message sent before one the transcript
  // has is never coming (a hook refused it).
  const last = Math.max(...live.filter((o) => settled.has(o.id)).map((o) => o.at))
  return out.filter((o) => !settled.has(o.id) && !(o.state === 'sent' && o.at < last))
}
