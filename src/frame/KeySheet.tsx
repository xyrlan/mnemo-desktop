// The key sheet (`?`): the design's table of fleet-wide keys, as it is bound in `keys.ts`.
// The foot of the frame carries the same keys in short, always.

import { create } from 'zustand'
import { Kbd } from '../ds'

export const sheetStore = create<{ open: boolean }>(() => ({ open: false }))

/** ⌥ on a Mac, Alt elsewhere. */
export const altName = (): string => (typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac') ? '⌥' : 'Alt')

export const KEYS: readonly { keys: string[]; does: string }[] = [
  { keys: ['↑', '↓'], does: 'previous, next session in roster order' },
  { keys: ['←', '→'], does: "through the family on stage: the parent, then each child" },
  { keys: ['Q'], does: 'the session you were on before; again at once, the one before that' },
  { keys: ['N'], does: 'the next thing that waits for you' },
  { keys: ['1', '–', '9'], does: 'answer the open waiting item' },
  { keys: ['R'], does: 'answer it in your words' },
  { keys: ['H', 'C', 'T'], does: 'Orbit (home), Console, Score (time)' },
  { keys: ['Enter'], does: 'into the terminal on stage; again, give it the room' },
  { keys: [';'], does: 'the command line' },
  { keys: ['Esc'], does: 'out of a card, a panel, the command line; never taken from a terminal' },
  { keys: ['?'], does: 'this sheet' },
]

/** The keys in short, for the foot of the frame. `alt`: the caret is in a terminal or a text
 *  field, where each needs Alt. */
export function KeyHints({ alt }: { alt: boolean }) {
  const hint = (keys: string[], does: string) => (
    <span>
      {keys.map((k) => (k === '–' ? '–' : <Kbd key={k}>{k}</Kbd>))} {does}
    </span>
  )
  return (
    <div className="frame-keys" data-alt={alt || undefined}>
      {alt && (
        <span className="frame-keys-alt">
          <Kbd>{altName()}</Kbd> with
        </span>
      )}
      {hint(['↑', '↓'], 'sessions')}
      {hint(['←', '→'], 'family')}
      {hint(['N'], 'next waiting')}
      {hint(['1', '–', '9'], 'answer')}
      {hint(['Q'], 'last')}
      {hint([';'], 'command')}
      {hint(['?'], 'keys')}
    </div>
  )
}

export function KeySheet() {
  const open = sheetStore((s) => s.open)
  if (!open) return null
  return (
    <div className="frame-veil" onClick={() => sheetStore.setState({ open: false })}>
      <div className="frame-sheet" role="dialog" aria-label="Keys">
        <h2 className="mn-label">keys</h2>
        <div className="frame-sheet-keys">
          {KEYS.map((k) => (
            <div key={k.does}>
              <span>{k.keys.map((x, i) => (x === '–' ? <i key={i}>to</i> : <Kbd key={i}>{x}</Kbd>))}</span>
              <span>{k.does}</span>
            </div>
          ))}
        </div>
        <p className="frame-sheet-note">
          Anywhere but a terminal or a text field these work bare. Inside one, hold <Kbd>{altName()}</Kbd>: the keys you type stay the session’s.
        </p>
      </div>
    </div>
  )
}
