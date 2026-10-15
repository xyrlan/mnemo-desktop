/** Who answers Esc typed in a note's textarea. Esc there drops the draft, but a frame that closes
 *  on Esc in the capture phase (the Nexus's windows) hears it first; such a frame asks
 *  `escapeOwner` and hands the key over instead of closing. */
const owners = new WeakMap<EventTarget, () => void>()

/** `cancel` is what Esc in `el` does. Kept for as long as `el` lives. */
export function ownEscape(el: EventTarget, cancel: () => void): void {
  owners.set(el, cancel)
}

/** What Esc typed in `target` does, when a note's textarea owns it. */
export function escapeOwner(target: EventTarget | null): (() => void) | null {
  return (target && owners.get(target)) ?? null
}
