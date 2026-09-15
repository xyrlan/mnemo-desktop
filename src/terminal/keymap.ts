/** macOS editing chords translated to what the shell (and Claude Code's prompt) already
 *  understand. Returns bytes to write, a clipboard verb, or null to let xterm handle it. */
export type ChordResult = { write: string } | { clipboard: 'copy' | 'paste' } | null

export type KeyLike = { key: string; metaKey: boolean; altKey: boolean; ctrlKey: boolean; shiftKey: boolean; type?: string }

export function macChord(e: KeyLike): ChordResult {
  if (!e.metaKey || e.ctrlKey) return null
  const k = e.key
  if (e.altKey) return null
  switch (k) {
    case 'ArrowLeft': return { write: '\x01' } // Ctrl-A: line start
    case 'ArrowRight': return { write: '\x05' } // Ctrl-E: line end
    case 'Backspace': return { write: '\x15' } // Ctrl-U: kill line
    case 'Enter': return { write: '\r' }
    case 'c': case 'C': return { clipboard: 'copy' }
    case 'v': case 'V': return { clipboard: 'paste' }
    default: return null
  }
}
