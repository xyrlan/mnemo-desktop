/** Synthetic transcript records for the parent's tests, in Claude Code's shape (the parser's own
 *  tests build theirs the same way). Made up: no real transcript or request is in here. */

import type { TranscriptRecord } from '../../conversation/types'

const SID = 'parent-1'
/** 2026-10-23 10:00:00 UTC, the transcript's clock: each record a second after the last. */
export const T0 = Date.UTC(2026, 9, 23, 10, 0, 0)

export function transcript() {
  let clock = 0
  const ts = () => new Date(T0 + 1000 * clock++).toISOString()
  const base = (type: string, uuid: string) => ({ type, uuid, parentUuid: null, timestamp: ts(), sessionId: SID })
  return {
    /** The ms the next record will carry. */
    next: () => T0 + 1000 * clock,
    prompt: (uuid: string, text: string): TranscriptRecord => ({ ...base('user', uuid), message: { role: 'user', content: text } }),
    said: (uuid: string, text: string): TranscriptRecord => ({ ...base('assistant', uuid), message: { role: 'assistant', content: [{ type: 'text', text }] } }),
    tool: (uuid: string, id: string, name: string, input: Record<string, unknown>): TranscriptRecord => ({
      ...base('assistant', uuid),
      message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
    }),
    result: (uuid: string, toolUseId: string, content: string): TranscriptRecord => ({
      ...base('user', uuid),
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content }] },
    }),
    end: (uuid: string): TranscriptRecord => ({ ...base('system', uuid), subtype: 'turn_duration', durationMs: 1000 }),
  }
}

/** Records as the tailer sends them: one JSONL line each. */
export const lines = (records: TranscriptRecord[]) => records.map((r) => JSON.stringify(r))
