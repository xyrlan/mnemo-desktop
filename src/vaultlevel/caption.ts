/** The square's caption: past tense, third person, with a target and an age. The overlay keeps
 *  its own present-tense voice in `caption()` (`src/avatar/scenes.ts`); this one reports on any
 *  session, so "that command" would have no referent. Pure. */
import type { PulseEvent, PulseKind } from '../pulse/types'

export type SquareCaption = {
  verb: string
  /** What the action was done to. Absent when the event does not say: `blocked`, never
   *  `blocked undefined`. */
  target?: string
  /** `project · age`, or just the age when the event names no project. */
  where: string
  age: string
}

const count = (n: number | undefined, one: string, many: string) => (n === undefined ? undefined : `${n} ${n === 1 ? one : many}`)
const nonEmpty = (s: string | undefined) => (s ? s : undefined)

const LINES: Record<PulseKind, [string, (e: PulseEvent) => string | undefined]> = {
  reflex: ['injected', (e) => count(e.hits, 'rule', 'rules')],
  tool: ['read', (e) => nonEmpty(e.slugs?.[0]) ?? 'memory'],
  enrich: ['recalled', (e) => nonEmpty(e.tool)],
  enforce: ['blocked', (e) => nonEmpty(e.tool)],
  briefing: ['saved', () => 'briefing'],
  catchup: ['caught up', () => undefined],
  learned: ['learned', (e) => nonEmpty(e.slugs?.[0])],
  friction: ['noted', () => 'friction'],
  dispatch: ['dispatched', (e) => count(e.hits, 'child', 'children')],
}

/** `12s`, `4m`, `2h`, `3d`: always a number, never "a long time ago". A clock skewed into the
 *  future reads as now. */
export function ageOf(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

export function squareCaption(event: PulseEvent, now: number): SquareCaption {
  const [verb, target] = LINES[event.kind] ?? [event.kind, () => undefined]
  const age = ageOf(now - event.at)
  return { verb, target: target(event), where: event.project ? `${event.project} · ${age}` : age, age }
}
