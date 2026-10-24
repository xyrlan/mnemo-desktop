/** The caption under the orb (#506): what was heard, then what James is saying, each fading. The
 *  main window picks them from the panel's lines (`captionsOf`); the orb's page fades them
 *  (`alphaOf`). Imports nothing but types: the orb's page loads none of the app. */
import type { Line } from '../store'
import type { Caption } from './show'

/** A caption stays this long, then fades over `FADE_MS`. */
export const HOLD_MS = 6000
export const FADE_MS = 1000
/** What was heard, once James answers: it steps back behind his words. */
export const BEHIND = 0.5
/** A caption is one line under a small orb: past this it ends in "…". */
export const CAPTION_MAX = 140

const clip = (s: string) => (s.length > CAPTION_MAX ? `${s.slice(0, CAPTION_MAX - 1).trimEnd()}…` : s)

/** The captions of the conversation that began at `since`: the last take heard, then James's last
 *  reply to it, as he says it (`spoken`, `forSpeech` from `../speech`). */
export function captionsOf(lines: readonly Line[], since: number, spoken: (text: string) => string): Caption[] {
  let heard = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]
    if (l.at < since) break
    if (l.who === 'you' && l.spoken) {
      heard = i
      break
    }
  }
  if (heard < 0) return []
  const you = lines[heard] as Extract<Line, { who: 'you' }>
  const out: Caption[] = [{ who: 'you', text: clip(you.text), at: you.at }]
  for (let i = lines.length - 1; i > heard; i--) {
    const l = lines[i]
    if (l.who !== 'james') continue
    const text = spoken(l.text)
    if (text) out.push({ who: 'james', text: clip(text), at: l.at })
    break
  }
  return out
}

/** How opaque `c` is at `now`, 0–1, among `all`: whole for `HOLD_MS`, then fading out over
 *  `FADE_MS`; what was heard is `BEHIND` once a reply follows it. */
export function alphaOf(c: Caption, all: readonly Caption[], now: number): number {
  const age = now - c.at
  const fade = age <= HOLD_MS ? 1 : Math.max(0, 1 - (age - HOLD_MS) / FADE_MS)
  const behind = c.who === 'you' && all.some((o) => o.who === 'james') ? BEHIND : 1
  return fade * behind
}
