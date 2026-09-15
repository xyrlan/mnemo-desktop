/** macOS editing chords translated to what the shell (and Claude Code's prompt) already
 *  understand. Returns bytes to write, a clipboard verb, or null to let xterm handle it. */
export type ChordResult = { write: string } | { clipboard: 'copy' | 'paste' } | null

export type KeyLike = { key: string; metaKey: boolean; altKey: boolean; ctrlKey: boolean; shiftKey: boolean; type?: string }

export function macChord(e: KeyLike): ChordResult {
  // Shift+Enter: xterm would send a bare CR, indistinguishable from Enter. Claude Code only
  // reads CSI-u (`ESC[13;2u`) after the terminal answers its kitty-keyboard probe, which
  // xterm.js never does; `ESC CR` is the fallback its own `/terminal-setup` installs for
  // VS Code and is read as a newline everywhere.
  if (e.key === 'Enter' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) return { write: '\x1b\r' }
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
