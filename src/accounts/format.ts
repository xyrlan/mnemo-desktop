import type { PlanLimit } from './types'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

/** The kinds the endpoint gave on 2026-10-07. Any other is named from its own words. */
const KNOWN: Record<string, string> = { session: 'Session', weekly_all: 'Weekly', weekly_scoped: 'Weekly' }

/** What a limit is called: its kind (`session` → "Session"), and its model when it is scoped to one
 *  ("Weekly · Fable"). A kind the app does not know is named from its own words
 *  (`monthly_opus_extra` → "Monthly opus extra"). */
export function limitName(l: Pick<PlanLimit, 'kind' | 'model'>): string {
  const words = l.kind.replace(/[_-]+/g, ' ').trim()
  const kind = KNOWN[l.kind] ?? (words ? words[0].toUpperCase() + words.slice(1) : 'Limit')
  return l.model ? `${kind} · ${l.model}` : kind
}

/** A window whose reset has passed reads 0% in it: an old reading stays close to right (decision 6). */
export function percentNow(l: Pick<PlanLimit, 'percent' | 'resetsAt'>, now: number): number {
  const reset = l.resetsAt ? Date.parse(l.resetsAt) : NaN
  if (!Number.isNaN(reset) && reset <= now) return 0
  return Math.max(0, Math.min(100, Math.round(l.percent)))
}

/** The account's tightest limit: the highest percent now; on a tie, the one the endpoint marks
 *  active. Undefined without limits. */
export function tightest(limits: PlanLimit[], now: number): PlanLimit | undefined {
  let best: PlanLimit | undefined
  for (const l of limits) {
    if (!best) best = l
    else {
      const a = percentNow(l, now)
      const b = percentNow(best, now)
      if (a > b || (a === b && l.active && !best.active)) best = l
    }
  }
  return best
}

export type Tone = 'ok' | 'warn' | 'bad' | 'unknown'

/** The colour a `severity` paints its bar. The endpoint's words beyond `normal` are not known;
 *  any other word reads by what it says, and one that says nothing known is neutral. */
export function tone(severity: string): Tone {
  const s = severity.toLowerCase()
  if (s === 'normal' || s === 'ok' || s === 'low') return 'ok'
  if (/warn|approach|medium|elevated|near/.test(s)) return 'warn'
  if (/crit|exceed|over|block|reach|limit|max|high|severe|error|danger/.test(s)) return 'bad'
  return 'unknown'
}

const pad = (n: number) => String(n).padStart(2, '0')
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** When a window resets, from `now`: "in 45 m", "in 3 h 20 m", and past a day the local day and
 *  time ("Tue 13:00"). Null when the limit gives none or it is not a date. */
export function resetsWhen(resetsAt: string | null, now: number): string | null {
  if (!resetsAt) return null
  const at = Date.parse(resetsAt)
  if (Number.isNaN(at)) return null
  const left = at - now
  if (left <= 0) return 'reset'
  if (left < MIN) return 'in under a minute'
  if (left < HOUR) return `in ${Math.floor(left / MIN)} m`
  if (left < DAY) {
    const h = Math.floor(left / HOUR)
    const m = Math.floor((left % HOUR) / MIN)
    return m ? `in ${h} h ${m} m` : `in ${h} h`
  }
  const d = new Date(at)
  return `${WEEKDAYS[d.getDay()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** How old a reading made at `at` is: "just now", "5 m ago", "2 h ago", "3 d ago". */
export function age(at: number, now: number): string {
  const t = Math.max(0, now - at)
  if (t < MIN) return 'just now'
  if (t < HOUR) return `${Math.floor(t / MIN)} m ago`
  if (t < DAY) return `${Math.floor(t / HOUR)} h ago`
  return `${Math.floor(t / DAY)} d ago`
}
