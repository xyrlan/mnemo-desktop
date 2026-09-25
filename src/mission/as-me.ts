import { invoke } from '@tauri-apps/api/core'
import { bufferLines, tail } from '../terminal/buffer'
import { tauriPty } from '../pty/client'
import { DETACH_KEY, promptOptions } from '../cockpit/approve'

/** "Reply as me": the draft, as typed, goes into the child's own terminal through a hidden
 *  `claude attach <id>`, so it lands as the maintainer's turn (`origin.kind: "human"`) instead
 *  of a socket peer message, which Claude Code tells the child is never user approval (#86).
 *
 *  Measured on Claude Code 2.1.272 against real `--bg` children (2026-09-15):
 *  - several attaches can be open at once and share ONE input box: text half-typed in another
 *    attach is sent together with ours on Enter, so an input that is not empty is refused;
 *  - on a permission prompt typed letters are dropped and Enter picks the highlighted
 *    "1. Yes": the reply never lands and the tool runs, so a dialog is refused before
 *    attaching and again on screen right before each key;
 *  - ← does not detach, it opens the agent view with a new-session field focused; Ctrl+Z lets go
 *    of the session (on 2.1.282 it suspends the attach rather than ending it: see `attached`);
 *  - a bracketed paste keeps a multi-line reply as one turn (a bare newline would be Enter);
 *  - typed while the child works, the turn is queued and still `human`. */

/** One hidden attach: the PTY and the screen its output draws. */
export type AttachSession = {
  lines(): string[]
  write(data: string): Promise<void>
  exited(): boolean
  close(): Promise<void>
}

export type Deps = {
  /** What the child's process is parked on (`claude agents`), null when nothing. */
  waitingFor: (id: string) => Promise<string | null>
  /** A login shell on a hidden PTY; the command is typed into it. */
  open: () => Promise<AttachSession>
  sleep: (ms: number) => Promise<void>
  /** How long the attach gets to draw its input box. */
  timeoutMs: number
  /** How long the draft gets to show in the box, and the box to empty after Enter. */
  stepMs: number
}

const COLS = 120
const ROWS = 40
const POLL_MS = 150
/** The attach draws the screen twice while it connects; read it once this has passed. */
export const SETTLE_MS = 400
/** Lines at the bottom of the screen the input box has to be in, status lines included. */
const BOX_BOTTOM = 8

const RULE = /^\s*─{8,}/

export type InputBox = { text: string; normal: boolean }

/** The attached session's input box: the `❯` line between the two rules at the bottom of the
 *  screen, its text (wrapped lines joined) and whether vim mode is in NORMAL. Null when the
 *  bottom of the screen is something else: a permission dialog, the shell, "Attaching…". */
export function inputBox(lines: string[]): InputBox | null {
  const screen = tail(lines, ROWS)
  for (let b = screen.length - 1; b >= Math.max(1, screen.length - BOX_BOTTOM); b--) {
    if (!RULE.test(screen[b])) continue
    let a = b - 1
    while (a >= 0 && !RULE.test(screen[a])) a--
    if (a < 0 || !screen[a + 1]?.startsWith('❯') || a + 1 >= b) return null
    const body = screen.slice(a + 1, b).map((l, i) => (i === 0 ? l.slice(1) : l))
    const status = screen.slice(b + 1).join('\n')
    return { text: body.map((l) => l.trim()).join('\n').trim(), normal: /--\s*NORMAL\s*--/.test(status) }
  }
  return null
}

/** The draft as Claude Code's input takes it: one bracketed paste, so newlines stay inside the
 *  turn. Control characters other than newline and tab are dropped, so the text cannot close
 *  the paste early or press keys. */
export function pasteOf(text: string): string {
  const clean = text.replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
  return `\x1b[200~${clean}\x1b[201~`
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim()

/** Whether the box holds the draft we pasted: its start, or the placeholder a long paste gets. */
export function boxShows(box: InputBox, text: string): boolean {
  if (/\[Pasted text #\d+/.test(box.text)) return true
  const want = squash(text).slice(0, 40)
  return want !== '' && squash(box.text).startsWith(want)
}

async function openHidden(): Promise<AttachSession> {
  // Loaded here, not at the top: the store and the rows import this module, and nothing else
  // on those paths needs a terminal emulator.
  const { Terminal } = await import('@xterm/xterm')
  const term = new Terminal({ cols: COLS, rows: ROWS, scrollback: 200, allowProposedApi: true })
  let exited = false
  const pane = await tauriPty.spawn({ cols: COLS, rows: ROWS, onOutput: (b) => term.write(b) })
  const unlisten = await tauriPty.onExit(pane, () => {
    exited = true
  })
  return {
    lines: () => bufferLines(term.buffer.active),
    write: (data) => tauriPty.write(pane, data),
    exited: () => exited,
    close: async () => {
      unlisten()
      if (!exited) await tauriPty.kill(pane).catch(() => {})
      term.dispose()
    },
  }
}

const defaults: Deps = {
  waitingFor: (id) => invoke<string | null>('mission_waiting_for', { id }),
  open: openHidden,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  timeoutMs: 20_000,
  stepMs: 5_000,
}

/** How long `until` waits for what it looks for; what it looks for returns null until then. */
export type Until = <T>(what: string, ms: number, probe: () => T | null) => Promise<T>

/** Runs `body` inside a hidden `claude attach <id>`, then, whatever happened, presses Ctrl+Z and
 *  closes the PTY. On Claude Code 2.1.282 Ctrl+Z does not end the attach (seen live in #266:
 *  the process was still there 3 s later), so nothing waits for it to: closing the PTY ends it. */
export async function attached<R>(id: string, d: Deps, body: (s: AttachSession, until: Until) => Promise<R>): Promise<R> {
  const s = await d.open()
  try {
    // `exec`: when the attach ends, the PTY ends, and no shell is left to type into.
    await s.write(`exec claude attach ${id}\r`)
    const until: Until = async (what, ms, probe) => {
      const end = Date.now() + ms
      for (;;) {
        const got = probe()
        if (got !== null) return got
        if (s.exited()) throw new Error(`claude attach ${id} ended before ${what}`)
        if (Date.now() > end) throw new Error(`claude attach ${id}: ${what} did not happen, attach to check`)
        await d.sleep(POLL_MS)
      }
    }
    return await body(s, until)
  } finally {
    if (!s.exited()) await s.write(DETACH_KEY).catch(() => {})
    await s.close()
  }
}

/** What a hidden attach runs on in the app. */
export const attachDefaults: Deps = defaults

/** Types `text` into child `id`'s terminal as the maintainer and presses Enter. Resolves once
 *  the input box took it; rejects with what to do by hand when a guard stops it. */
export async function typeAsMe(id: string, text: string, deps: Partial<Deps> = {}): Promise<void> {
  const d = { ...defaults, ...deps }
  if (!text.trim()) throw new Error('nothing to type')
  // Typed first, a `!` puts Claude Code's input in shell mode: the reply would run as a command.
  if (text.trimStart().startsWith('!')) throw new Error("a reply that starts with ! would run as a shell command in the child's terminal: reword it, nothing was typed")
  const waiting = await d.waitingFor(id)
  if (waiting) throw new Error(`${id} is on a ${waiting}: answer it first, keys typed now would go to the dialog`)

  await attached(id, d, async (s, until) => {
    const dialog = () => {
      if (promptOptions(s.lines())) throw new Error(`${id} is showing a prompt: answer it first, nothing more was typed`)
    }
    const box = () => {
      dialog()
      return inputBox(s.lines())
    }

    await until('its input box showed', d.timeoutMs, box)
    await d.sleep(SETTLE_MS)
    const before = await until('its input box showed', d.timeoutMs, box)
    if (before.text) throw new Error(`${id}'s input already holds "${before.text.slice(0, 60)}", typed in another attach: send or clear it there, nothing was typed`)
    if (before.normal) throw new Error(`${id}'s input is in vim NORMAL mode: press i there, nothing was typed`)

    await s.write(pasteOf(text))
    await until('the draft showed in its input', d.stepMs, () => {
      const b = box()
      return b && boxShows(b, text) ? b : null
    })

    dialog()
    await s.write('\r')
    await until('Enter sent the draft', d.stepMs, () => {
      const b = inputBox(s.lines())
      // No box but a dialog: the turn was taken and the child already asks for a tool.
      if (b === null) return promptOptions(s.lines()) ? true : null
      return b.text === '' ? true : null
    })
  })
}
