// What the maintainer typed on the stage and the world does not carry yet: the words sent to
// each session from here (so they stand in its transcript the moment they are sent) and the
// draft left in each session's reply box (so walking the family does not lose it). Kept for
// the page's life; a reload starts clean, and by then the world has the words.

import { create } from 'zustand'
import type { Sent } from './model'

interface SaidState {
  sent: Record<string, Sent[]>
  drafts: Record<string, string>
  say(sessionId: string, text: string, at: number): void
  draft(sessionId: string, text: string): void
}

/** How many sent lines a session's transcript keeps. */
const KEEP = 20

export const saidStore = create<SaidState>((set) => ({
  sent: {},
  drafts: {},
  say: (sessionId, text, at) => set((s) => ({ sent: { ...s.sent, [sessionId]: [...(s.sent[sessionId] ?? []), { at, text }].slice(-KEEP) } })),
  draft: (sessionId, text) => set((s) => (s.drafts[sessionId] === text || (!text && !(sessionId in s.drafts)) ? s : { drafts: { ...s.drafts, [sessionId]: text } })),
}))

const NONE: Sent[] = []

export const useSent = (sessionId: string): Sent[] => saidStore((s) => s.sent[sessionId] ?? NONE)
export const useDraft = (sessionId: string): string => saidStore((s) => s.drafts[sessionId] ?? '')
