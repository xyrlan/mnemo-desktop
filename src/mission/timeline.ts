import type { StatusMarker } from '../conversation/types'
import type { TimelineLine } from './types'

/** A child's `timeline.jsonl` as thin lines for its conversation: one marker per state change,
 *  not per poll, at the first line of the new state. A `working` child's detail is its current
 *  tool call (`Running git log…`), which the conversation already shows as a card: 28 of a real
 *  child's 67 lines differed only there, against one state change. So only `blocked` keeps its
 *  detail, because what it waits for is news (`blocked · awaiting approval`), and a new wait is
 *  a new marker. A line with no parsable `at` keeps its place in the file (written in order) by
 *  taking the time of the line before it. */
export function statusMarkers(lines: TimelineLine[]): StatusMarker[] {
  const markers: StatusMarker[] = []
  let prevAt: string | null = null
  let prevKey: string | null = null
  for (const l of lines) {
    const at: string = Number.isNaN(Date.parse(l.at)) ? (prevAt ?? l.at) : l.at
    prevAt = at
    const detail = l.state === 'blocked' ? l.detail : ''
    const key = `${l.state}\n${detail}`
    if (key === prevKey) continue
    prevKey = key
    markers.push({ at, label: detail ? `${l.state} · ${detail}` : l.state })
  }
  return markers
}

export function clock(ms: number, seconds = true): string {
  if (!Number.isFinite(ms)) return ''
  return new Date(ms).toLocaleTimeString([], seconds ? { hour: '2-digit', minute: '2-digit', second: '2-digit' } : { hour: '2-digit', minute: '2-digit' })
}
