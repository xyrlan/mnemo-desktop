import type { StatusMarker } from '../conversation/types'
import type { TimelineLine } from './types'

/** A child's `timeline.jsonl` as thin lines for its conversation: one marker per state change,
 *  not per poll. Consecutive identical `state + detail` lines collapse into the first, which is
 *  when the change happened. The label reads `blocked · awaiting approval`, or `done` when the
 *  line has no detail. A line with no parsable `at` keeps its place in the file (written in
 *  order) by taking the time of the line before it. */
export function statusMarkers(lines: TimelineLine[]): StatusMarker[] {
  const markers: StatusMarker[] = []
  let prevAt: string | null = null
  let prevKey: string | null = null
  for (const l of lines) {
    const at: string = Number.isNaN(Date.parse(l.at)) ? (prevAt ?? l.at) : l.at
    prevAt = at
    const key = `${l.state}\n${l.detail}`
    if (key === prevKey) continue
    prevKey = key
    markers.push({ at, label: l.detail ? `${l.state} · ${l.detail}` : l.state })
  }
  return markers
}

export function clock(ms: number, seconds = true): string {
  if (!Number.isFinite(ms)) return ''
  return new Date(ms).toLocaleTimeString([], seconds ? { hour: '2-digit', minute: '2-digit', second: '2-digit' } : { hour: '2-digit', minute: '2-digit' })
}
