// The Projects panel's pure part: what a key does, where the cursor goes, how a path reads.
// What a row lists (`liveSessions`), what adding a repo changes (`added`) and the clone's
// command are the ship's own (`src/nexus/windows/projects/model.ts`), used where they are.

import { tilde } from '../../world/format'

/** What a key asks of the panel while the list has the focus. `command`'s index is from 0. */
export type Act =
  | { kind: 'move'; by: 1 | -1 }
  | { kind: 'session' }
  | { kind: 'shell' }
  | { kind: 'command'; index: number }
  | { kind: 'save-command' }
  | { kind: 'filter' }
  | { kind: 'add' }
  | { kind: 'open-folder' }
  | { kind: 'clone' }

type Key = { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }

/** The act a key asks for; null when the key is not the panel's (it goes on to the frame).
 *  Enter starts a session, S a shell, a digit the saved command at that place: one key each. */
export function actOf(e: Key): Act | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null
  if (/^[1-9]$/.test(e.key)) return { kind: 'command', index: Number(e.key) - 1 }
  switch (e.key.length === 1 ? e.key.toLowerCase() : e.key) {
    case 'ArrowDown':
    case 'j':
      return { kind: 'move', by: 1 }
    case 'ArrowUp':
    case 'k':
      return { kind: 'move', by: -1 }
    case 'Enter':
      return { kind: 'session' }
    case 's':
      return { kind: 'shell' }
    case '+':
      return { kind: 'save-command' }
    case '/':
      return { kind: 'filter' }
    case 'a':
      return { kind: 'add' }
    case 'o':
      return { kind: 'open-folder' }
    case 'g':
      return { kind: 'clone' }
    default:
      return null
  }
}

/** The root the cursor is on after a move: the next or the previous of `roots`, stopping at the
 *  ends. A cursor that is no longer listed (the filter dropped it) lands on the first. */
export function moved(roots: readonly string[], cursor: string | null, by: 1 | -1): string | null {
  if (!roots.length) return null
  const at = cursor === null ? -1 : roots.indexOf(cursor)
  if (at < 0) return roots[0]
  return roots[Math.max(0, Math.min(roots.length - 1, at + by))]
}

/** The row the keys act on: the cursor while it is listed, else the first row. */
export const cursorOf = (roots: readonly string[], cursor: string | null): string | null => (cursor !== null && roots.includes(cursor) ? cursor : (roots[0] ?? null))

/** A path as a row shows it: the home folder as `~`, forward slashes. */
export const shortPath = (p: string): string => tilde(p)

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
