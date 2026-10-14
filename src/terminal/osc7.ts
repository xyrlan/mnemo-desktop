import { onWindows } from '../pty/typed'

/** OSC 7 payload: file://host/path → path (percent-decoded). On Windows a drive's folder however
 *  it was spelled — the URL's `/C:/x`, Git Bash's `/c/x`, Cygwin's `/cygdrive/c/x` — is `C:/x`.
 *  The same reading as `src-tauri/src/pty/screen.rs`. */
export function parseOsc7(data: string, windows = onWindows()): string | null {
  const m = /^file:\/\/[^/]*(\/.*)$/.exec(data)
  if (!m) return null
  let path: string
  try {
    path = decodeURIComponent(m[1])
  } catch {
    return null
  }
  return windows ? windowsPath(path) : path
}

function windowsPath(path: string): string {
  const p = /^\/cygdrive\//.test(path) ? path.slice('/cygdrive'.length) : path
  const d = /^\/([A-Za-z])(?::|(?=\/|$))\/*(.*)$/s.exec(p)
  return d ? `${d[1].toUpperCase()}:/${d[2]}` : path
}

/** OSC 9 payload, `9;<folder>` (ConEmu's 9;9, as Windows Terminal reads it: cmd's and
 *  PowerShell's prompt send it here, WSL and starship there), the folder as the shell spells it,
 *  maybe in double quotes. Null for any other OSC 9, such as a notification. */
export function parseOsc9(data: string): string | null {
  if (!data.startsWith('9;')) return null
  const raw = data.slice(2)
  const path = /^".*"$/s.test(raw) ? raw.slice(1, -1) : raw
  return path || null
}
