/** When James's orb shows, and how it looks (#503, #506). Pure, so the rules are tested over a
 *  sequence of phases; `./control` runs them over the store. This file is shared by the main
 *  window and the orb's page, so it imports nothing but types. */
import type { VoicePhase } from '../client'

/** One look per state: `listening` moves with the microphone, `thinking` (transcribing, or James
 *  working on a request) is a calm swirl, `speaking` moves with the speaker, `waiting` (the
 *  follow-up window) is a slow breath. */
export type OrbLook = 'listening' | 'thinking' | 'speaking' | 'waiting'

/** The orb fades out over this long once the conversation is over, then hides. */
export const LINGER_MS = 1500

/** How the orb looks for the voice's phase and whether a request is being worked on; null once
 *  the conversation is over (the voice idle, nothing being worked on). */
export function lookOf(voice: VoicePhase, busy: boolean): OrbLook | null {
  switch (voice) {
    case 'listening':
      return 'listening'
    case 'transcribing':
      return 'thinking'
    case 'speaking':
      return 'speaking'
    case 'waiting':
      return 'waiting'
    case 'idle':
      return busy ? 'thinking' : null
  }
}

/** Whether the orb is up. `since`: when this conversation began, for the captions. `overAt`: when
 *  it went over, while the orb fades. */
export type Shown = { shown: boolean; since: number; overAt: number | null }
export const HIDDEN: Shown = { shown: false, since: 0, overAt: null }

/** The orb after `look` at `now`. It comes up with the first look, stays through the gaps between
 *  phases, and goes `LINGER_MS` after the last one; a look within that time keeps the same
 *  conversation going. */
export function stepShow(s: Shown, look: OrbLook | null, now: number): Shown {
  if (look) return s.shown ? (s.overAt === null ? s : { ...s, overAt: null }) : { shown: true, since: now, overAt: null }
  if (!s.shown) return s
  const overAt = s.overAt ?? now
  if (now - overAt >= LINGER_MS) return HIDDEN
  return overAt === s.overAt ? s : { ...s, overAt }
}

/** A caption under the orb: what was heard, then what James is saying. */
export type Caption = { who: 'you' | 'james'; text: string; at: number }

/** `jarvis://orb`: what the main window tells the orb (`./control`). `look` null: fading out. */
export type OrbState = { look: OrbLook | null; captions: Caption[] }
export const ORB_EVENT = 'jarvis://orb'
/** `jarvis://orb-ready`: the orb's page listens now, and wants the state it may have missed. */
export const ORB_READY = 'jarvis://orb-ready'
