import type { Conversation, TranscriptRecord } from './types'

/** One transcript line as a record; `null` for a line that is not a JSON object with a `type`. */
export function parseRecord(line: string): TranscriptRecord | null {
  try {
    const v: unknown = JSON.parse(line)
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
    return typeof (v as { type?: unknown }).type === 'string' ? (v as TranscriptRecord) : null
  } catch {
    return null
  }
}

/** The conversation `records` (in file order) describe. Pure: the same records always give the
 *  same cards, with the same ids.
 *
 *  Round 20 seam: the `parser` piece writes this body (docs/contracts/round20.md). */
export function deriveConversation(records: TranscriptRecord[]): Conversation {
  const first = records.find((r) => typeof r.sessionId === 'string')
  return { sessionId: (first?.sessionId as string | undefined) ?? null, title: null, prs: [], cards: [] }
}
