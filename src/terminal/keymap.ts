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

/** The parts of `navigator.clipboard` a paste needs, so the decision is testable. */
export type ClipboardLike = {
  read?: () => Promise<ReadonlyArray<{ types: ReadonlyArray<string>; getType: (type: string) => Promise<{ text: () => Promise<string> }> }>>
  readText: () => Promise<string>
}

/** Bytes ⌘V writes to the PTY. An image on the clipboard becomes a bare Ctrl+V: Claude Code
 *  reads the system clipboard itself on that key and attaches the image, which no text paste
 *  can carry. Otherwise the clipboard's text, or null when there is nothing to paste. The
 *  clipboard is read once when `read()` works (WebKit may ask the user per read). */
export async function pasteBytes(clip: ClipboardLike): Promise<string | null> {
  let items
  try {
    items = clip.read ? await clip.read() : undefined
  } catch {
    // read() refused: fall back to text, as ⌘V always did.
  }
  try {
    if (!items) return (await clip.readText()) || null
    if (items.some((i) => i.types.some((t) => t.startsWith('image/')))) return '\x16'
    const item = items.find((i) => i.types.includes('text/plain'))
    return (item && (await (await item.getType('text/plain')).text())) || null
  } catch {
    return null
  }
}
