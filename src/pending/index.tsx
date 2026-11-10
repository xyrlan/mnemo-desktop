// What waits, and how it is answered: one card, one keyed list, in every view
// (docs/superpowers/specs/2026-11-10-recreation-design.md, "One way to answer").
//
// A view draws `PendingCard` where the item is listed and says whether it is the armed one
// (`armedPending`). The frame's keys call `answerArmed` (a digit), `replyArmed` (`R`) and walk
// with `nextPending` (`N`); `WaitingCount` is the top bar's count. `state.ts` keeps what a
// card is in the middle of, so every drawing of an item agrees.

export { PendingCard } from './PendingCard'
export { WaitingCount } from './WaitingCount'
export { answerArmed, armedPending, nextPending, replyArmed } from './state'
