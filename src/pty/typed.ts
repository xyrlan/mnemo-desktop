/** What the app types into a pane's shell, written for that shell (#331). A pane runs `$SHELL` on
 *  macOS and Linux and `%COMSPEC%`, cmd.exe, on Windows (`pty.rs`, `default_shell`); a POSIX line
 *  typed into cmd runs nothing: it has no `exec` and no `env`, and reads no single quotes. Every
 *  command the app types is built here, for one of three shells, and ends in that shell's Enter.
 *
 *  The cmd and PowerShell lines are run for real, against a stand-in `claude`, by
 *  `scripts/typed-windows.test.mjs` on CI's Windows job. */

export type Shell = 'posix' | 'cmd' | 'powershell'

export const onWindows = () => typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)

/** The shell of a pane the app just spawned and has not read yet. On Windows that is cmd:
 *  `%COMSPEC%` is set by the system on every install. The front end cannot ask which program a
 *  pane runs, so a machine whose `COMSPEC` names PowerShell gets cmd's line here. */
export const paneShell = (windows = onWindows()): Shell => (windows ? 'cmd' : 'posix')

/** Lines of screen, from the bottom, a prompt is looked for in. */
const SCREEN_ROWS = 40

/** The shell a pane shows, by its prompt: PowerShell's starts with `PS `. */
export function shellOf(lines: string[], windows: boolean): Shell {
  if (!windows) return 'posix'
  let end = lines.length
  while (end > 0 && lines[end - 1].trim() === '') end--
  const last = lines.slice(Math.max(0, end - SCREEN_ROWS), end).at(-1) ?? ''
  return /^PS /.test(last) ? 'powershell' : 'cmd'
}

/** `s` as one POSIX shell word: bare when it is only safe characters, else single-quoted. */
export function shellWord(s: string): string {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`
}

/** `s` where cmd reads it outside quotes: each character cmd would act on gets its caret. */
const cmdBare = (s: string) => s.replace(/[\^&|<>()]/g, '^$&')

/** `cmd` as it is typed to run with the variable `name` set to `value`, or unset for null, and
 *  the pane's shell left as it was.
 *  - POSIX: `env`, which reads the same in zsh, bash and fish.
 *  - cmd: a second cmd runs `set "NAME=value"& <cmd>`. `/s` takes the line between the outer
 *    quotes as it is, so the value sits in quotes there; the pane's own cmd reads it first, with
 *    the value outside quotes, hence the carets. `&`, not `&&`: `set "NAME="` on a variable that
 *    is not set fails. A `%` in the value is not escaped: at a prompt cmd has no way to.
 *  - PowerShell: the variable is process-wide, so it is put back afterwards. Assigning `$null`
 *    removes it. */
export function withEnv(cmd: string, name: string, value: string | null, shell: Shell): string {
  switch (shell) {
    case 'posix':
      return value === null ? `env -u ${name} ${cmd}` : `env ${name}=${shellWord(value)} ${cmd}`
    case 'cmd':
      return `cmd /d /s /c "set "${name}=${cmdBare(value ?? '')}"& ${cmd}"`
    case 'powershell': {
      const to = value === null ? '$null' : `'${value.replace(/'/g, "''")}'`
      return `$mnemoWas = $env:${name}; $env:${name} = ${to}; try { ${cmd} } finally { $env:${name} = $mnemoWas }`
    }
  }
}

/** `cmd` typed so that the shell ends with it: when it is over the PTY is too, and no shell is
 *  left to take the keys meant for it. POSIX shells replace themselves; cmd and PowerShell have no
 *  `exec`, and leave after it. */
export function thenLeave(cmd: string, shell: Shell): string {
  switch (shell) {
    case 'posix':
      return `exec ${cmd}`
    case 'cmd':
      return `${cmd} & exit`
    case 'powershell':
      return `${cmd}; exit`
  }
}

/** Enter at a shell's prompt. A Windows console takes `\r`. A POSIX terminal takes either (its
 *  line discipline turns `\r` into `\n`), and each place keeps the one it always typed. */
export const enter = (shell: Shell, posix: '\n' | '\r' = '\n') => (shell === 'posix' ? posix : '\r')

/** `cmd` and Enter, as typed into a pane running `shell`. */
export const typed = (cmd: string, shell: Shell = paneShell(), posix: '\n' | '\r' = '\n') => cmd + enter(shell, posix)

/** What a pane shows when a command could not be typed into it: drawn by its terminal, on a line
 *  of its own, never sent to its shell. */
export function notTyped(cmd: string, why: unknown): Uint8Array {
  const reason = why instanceof Error ? why.message : String(why)
  return new TextEncoder().encode(`\r\n\x1b[31mmnemo: could not type \`${cmd}\` here: ${reason}\x1b[0m\r\n`)
}
