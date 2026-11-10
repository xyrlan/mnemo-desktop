// Answering a session that runs in one of the app's own terminals, from a card. A child in the
// background is answered through a hidden `claude attach`, whose screen is read before a key is
// pressed (`src/cockpit/approve.ts`, `src/mission/ask.ts`, `src/mission/as-me.ts`). A session in a
// pane needs no attach: its terminal is here. The same guards are held on the pane's own screen,
// read at the moment of the key, with the readers those paths use: the prompt on screen must be
// the one the card shows, a digit is never pressed on the wrong kind of dialog, and nothing is
// typed into an input box that holds a draft.

import { answerText, KEY_GAP_MS, SUBMIT_GAP_MS } from '../chat-input/pty'
import { asksAbout } from '../cockpit/approve'
import { keyFor, promptOnScreen, type Choice } from '../cockpit/prompt'
import { inputBox } from '../mission/as-me'
import { questionOnScreen, type Question } from '../mission/ask'

export type PaneDeps = {
  /** What terminal `pane` shows now, scrollback included; undefined when it cannot be read. */
  screen(pane: number): Promise<string[] | undefined>
  /** Whether an agent CLI still runs under the pane's shell, asked now (`paneRunsClaude`): rejects
   *  when the app cannot tell. */
  runsClaude(pane: number): Promise<boolean>
  write(pane: number, data: string): Promise<void>
  /** Types `text` into the pane's Claude as a prompt and submits it (`ptySendPrompt`). */
  prompt(pane: number, text: string): Promise<void>
  sleep(ms: number): Promise<void>
}

/** The screen of a pane that still runs its agent. Rejects, nothing typed, when it does not. */
async function screenOf(d: PaneDeps, pane: number): Promise<string[]> {
  if (!(await d.runsClaude(pane))) throw new Error('Claude is not running in its terminal: nothing was typed.')
  const lines = await d.screen(pane)
  if (!lines) throw new Error('Its screen could not be read: answer it in its terminal.')
  return lines
}

const flat = (s: string) =>
  s
    .replace(/(…|\.\.\.)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

/** Whether the option on screen is the one the card shows, a cut-off end aside. */
export function sameOption(onScreen: string, onCard: string): boolean {
  const a = flat(onScreen)
  const b = flat(onCard)
  return a !== '' && b !== '' && (a.startsWith(b) || b.startsWith(a))
}

/** Presses `choice` on the permission prompt pane `pane` shows. `card`: what the card says it asks
 *  about, as the world gives it (a command, a file: `Pending.detail`), null when the card knows
 *  only that it waits. */
export async function pressPermission(d: PaneDeps, pane: number, choice: Choice, card: string | null): Promise<void> {
  const lines = await screenOf(d, pane)
  if (questionOnScreen(lines)) throw new Error('It is showing a question, not a permission prompt: nothing was pressed.')
  const prompt = promptOnScreen(lines)
  if (!prompt) throw new Error('No permission prompt is on its screen now: nothing was pressed.')
  if (card !== null && !asksAbout(prompt, card)) throw new Error('The prompt on its screen is not the one this card shows: nothing was pressed.')
  const key = keyFor(prompt.options, choice)
  if (key === null) throw new Error('This prompt does not offer "don\'t ask again": nothing was pressed.')
  await d.write(pane, key)
}

/** The question on screen, or a rejection saying what is there instead. */
function question(lines: string[]): Question {
  if (promptOnScreen(lines)) throw new Error('It is showing a permission prompt, not a question: nothing was typed.')
  const q = questionOnScreen(lines)
  if (!q) throw new Error('No question is on its screen now: nothing was typed.')
  if (q.kind === 'review') throw new Error('Its question is on its review: submit it in its terminal, nothing was typed.')
  if (q.multi) throw new Error('Its question takes several answers: tick them in its terminal, nothing was typed.')
  return q
}

/** Picks option `index` (0-based) of the question pane `pane` asks; `label` is the card's. */
export async function pickOption(d: PaneDeps, pane: number, index: number, label: string): Promise<void> {
  const q = question(await screenOf(d, pane))
  const o = q.options[index]
  if (!o) throw new Error(`The question on its screen has ${q.options.length} options, not ${index + 1}: nothing was typed.`)
  if (!sameOption(o.text, label)) throw new Error('The question on its screen is not the one this card shows: nothing was typed.')
  await d.write(pane, String(o.n))
}

/** Answers the question pane `pane` asks in words, through its "Type something." row. */
export async function answerInWords(d: PaneDeps, pane: number, text: string): Promise<void> {
  const words = answerText(text)
  if (!words) throw new Error('Nothing to send.')
  const q = question(await screenOf(d, pane))
  await d.write(pane, String(q.other))
  await d.sleep(KEY_GAP_MS)
  await d.write(pane, words)
  await d.sleep(SUBMIT_GAP_MS)
  await d.write(pane, '\r')
}

/** Sends `text` to the session in pane `pane` as the maintainer's turn. Nothing is typed while a
 *  dialog is up, nor into an input box that holds a draft or is not on screen. */
export async function sendPrompt(d: PaneDeps, pane: number, text: string): Promise<void> {
  if (!text.trim()) throw new Error('Nothing to send.')
  // Typed first, a `!` puts Claude Code's input in shell mode: the text would run as a command.
  if (text.trimStart().startsWith('!')) throw new Error('A reply that starts with ! would run as a shell command there: reword it, nothing was typed.')
  const lines = await screenOf(d, pane)
  if (promptOnScreen(lines) || questionOnScreen(lines)) throw new Error('It is showing a prompt: answer it first, nothing was typed.')
  const box = inputBox(lines)
  if (!box) throw new Error('Its input box is not on screen: type it in its terminal.')
  if (box.text) throw new Error(`Its input already holds "${box.text.slice(0, 60)}": send or clear it there, nothing was typed.`)
  if (box.normal) throw new Error('Its input is in vim NORMAL mode: press i there, nothing was typed.')
  await d.prompt(pane, text)
}
