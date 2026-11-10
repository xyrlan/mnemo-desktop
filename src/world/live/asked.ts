// Where each dialog of several questions is: the transcript holds the call and all its
// questions from the start and says nothing more until every one is answered, so which one
// the terminal is on is only known to what answers it. The runtime moves this as it types an
// answer, and when a terminal's screen shows another question than the card's.

import { createStore } from 'zustand/vanilla'

/** By the call's id: the index of the question its dialog is on; the number of questions when
 *  it is on its review. */
export const askedStore = createStore<{ at: Record<string, number> }>(() => ({ at: {} }))

/** Dialogs remembered at once: one is over as soon as its call is answered. */
const KEPT = 40

export function setAsked(ask: string, at: number): void {
  askedStore.setState((s) => {
    if (s.at[ask] === at) return s
    const rest = Object.entries(s.at).filter(([id]) => id !== ask)
    return { at: Object.fromEntries([...rest.slice(-(KEPT - 1)), [ask, at]]) }
  })
}
