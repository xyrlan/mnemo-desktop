import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { PaneId } from '../layout/tree'

/** ASCII that a shell reads literally anywhere in a word. Everything else ASCII is escaped;
 *  non-ASCII (accents, the U+202F in macOS screenshot names) is never special to a shell. */
const SAFE = /[A-Za-z0-9_\-.,/:@%+]/

function quote(path: string): string {
  let out = ''
  for (const ch of path) {
    const code = ch.codePointAt(0)!
    if (code > 0x7e || SAFE.test(ch)) out += ch
    // A raw control byte would reach the PTY as a keystroke (a newline submits the prompt).
    else if (code < 0x20 || code === 0x7f) out += `$'\\x${code.toString(16).padStart(2, '0')}'`
    else out += `\\${ch}`
  }
  return out
}

/** What a terminal types when files are dropped on it: each path backslash-escaped, joined by
 *  spaces, with a trailing space, as Terminal.app and iTerm do. Backslashes rather than quotes
 *  because Claude Code splits several dropped paths on a space followed by `/` and then strips
 *  the escapes, so it attaches each image; a shell reads the same text as one word per path. */
export function dropText(paths: string[]): string {
  const words = paths.filter((p) => p.length > 0).map(quote)
  return words.length ? `${words.join(' ')} ` : ''
}

/** The terminal pane files are being dragged over, for the pane highlight. */
export const fileDropStore = createStore<{ over: PaneId | null }>(() => ({ over: null }))
export const useFileDrop = <T,>(sel: (s: { over: PaneId | null }) => T) => useStore(fileDropStore, sel)
