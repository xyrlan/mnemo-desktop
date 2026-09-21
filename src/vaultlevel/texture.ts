/** Band 3 of the square: how busy mnemo has been lately, as texture. Pure.
 *
 *  Not a history. One thin bar per bucket of recent time, tall where pulses landed thickly and
 *  coloured by what mostly happened there. It carries no number, no tooltip and no legend,
 *  because the only question it answers is "has he been busy" — the caption directly above it
 *  already says what he last did, and a second marker for that fact is one too many. */
import { SCENES, type Scene } from '../avatar/scenes'
import type { PulseKind } from '../pulse/types'

/** One bucket. `height` is 0..1 of the band; an empty bucket is 0, and takes no tone. */
export type Bar = { height: number; tone: Scene['tone'] }

/** The stretch of time the texture covers. An hour: long enough that a quiet spell reads as
 *  quiet, short enough that a burst has not slid off the end before the eye finds it. */
export const SPAN_MS = 60 * 60_000

/** The floor under the tallest bucket. Heights are relative to the busiest bucket in the window
 *  — pulse rates differ by an order of magnitude between kinds, so any fixed ceiling would clip
 *  `tool` and flatten everything else — and this keeps one lone pulse in an empty hour a mark
 *  rather than a spike. */
export const BUSY = 4

/** What the texture needs of a pulse: when the app saw it, and what kind it was. `received`,
 *  not the row's `at`, for the same reason the overlay times itself by it — another machine's
 *  clock or a slow hook can put `at` anywhere, and a bucketed row of bars would show the skew
 *  as a gap. */
type Seen = { received: number; event: { kind: PulseKind } }

/** `buckets` bars, oldest first, always that many: the row is a stretch of time, so an hour with
 *  two pulses in it has to look like an hour with two pulses in it and not like two pulses. */
export function activityTexture(log: readonly Seen[], now: number, buckets: number, spanMs = SPAN_MS): Bar[] {
  if (buckets <= 0) return []
  const width = spanMs / buckets
  // Per bucket, how many of each tone, and where the last one of that tone sat in the log.
  const tones: Map<Scene['tone'], { n: number; last: number }>[] = Array.from({ length: buckets }, () => new Map())
  const totals = new Array<number>(buckets).fill(0)

  for (let i = 0; i < log.length; i++) {
    const age = now - log[i].received
    // A clock skewed into the future reads as now, the same way `ageOf` treats it. Anything
    // older than the window falls off the left-hand end: `at` goes negative, and one guard
    // covers both ends rather than two saying the same thing.
    const at = age <= 0 ? buckets - 1 : buckets - 1 - Math.floor(age / width)
    if (at < 0) continue
    const tone = SCENES[log[i].event.kind]?.tone ?? 'muted'
    const seen = tones[at].get(tone)
    if (seen) {
      seen.n++
      seen.last = i
    } else tones[at].set(tone, { n: 1, last: i })
    totals[at]++
  }

  const peak = Math.max(BUSY, ...totals)
  return totals.map((n, at) => {
    if (n === 0) return { height: 0, tone: 'muted' }
    // The bucket's dominant tone; a tie goes to whichever of them happened last, so the bar
    // leans towards the newer news.
    let tone: Scene['tone'] = 'muted'
    let best = -1
    let latest = -1
    for (const [t, seen] of tones[at]) {
      if (seen.n > best || (seen.n === best && seen.last > latest)) {
        tone = t
        best = seen.n
        latest = seen.last
      }
    }
    return { height: n / peak, tone }
  })
}
