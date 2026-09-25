import { tail } from '../terminal/buffer'
import { answerText, KEY_GAP_MS, SUBMIT_GAP_MS } from '../chat-input/pty'
import { promptOptions } from '../cockpit/approve'
import { attachDefaults, attached, SETTLE_MS, type Deps, type Until } from './as-me'

/** Answering a child parked on Claude Code's multiple-choice dialog (AskUserQuestion, `claude
 *  agents` says `input needed`). Like "as me", the keys go into a hidden `claude attach <id>`: the
 *  dialog is read off its screen, the option's number is pressed, and the attach is left once the
 *  dialog moved on. The keys are the ones the chat-input piece measured for a pane's Claude
 *  (`src/chat-input/pty.ts`): an option's digit answers it outright; in words, the digit of the
 *  "Type something." row, the words, then Enter.
 *
 *  A digit pressed on a permission prompt would allow a tool, so nothing is typed unless the child
 *  says it waits for input right before the attach, and the screen shows a question: a numbered
 *  list with the "Type something." row AskUserQuestion always adds, and no "Yes" prompt. */

/** Lines of screen, from the bottom, the dialog must sit in: older ones are scrollback. */
const SCREEN = 40
const ROW = /^[\s│|❯>›]*(\d+)\.\s+(.+?)\s*$/
const OTHER = /^type something\.?$/i
const SUBMIT = /^submit(\s+answers?)?$/i
/** A row that is ticked rather than picked: a question that takes several answers. */
const TICK = /^(\[[ x✔✓]?\]|[☐☑☒◻◼✓✔])\s/

export type Question = {
  kind: 'question'
  /** The options, numbered as the dialog numbers them. */
  options: { n: number; text: string }[]
  /** The "Type something." row's number: the answer in words. */
  other: number
  /** Its options are ticked, several at a time: a digit does not answer it. */
  multi: boolean
  /** The question's lines and its options: while these are on screen, it has not moved on.
   *  The "Type something." row is left out, since the words typed into it change it. */
  sig: string
}
/** The review a dialog of several questions ends on: its "Submit answers" row. */
export type Review = { kind: 'review'; submit: number; sig: string }

type Row = { n: number; text: string; at: number }

/** The last run of rows numbered 1, 2, 3… at the bottom of the screen, and the lines just above
 *  it; lines between rows (an option's description) are skipped. */
function numbered(lines: string[]): { rows: Row[]; above: string[] } | null {
  const screen = tail(lines, SCREEN)
  let start = -1
  for (let i = screen.length - 1; i >= 0; i--) {
    const m = ROW.exec(screen[i])
    if (m && m[1] === '1') {
      start = i
      break
    }
  }
  if (start < 0) return null
  const rows: Row[] = []
  for (let i = start; i < screen.length; i++) {
    const m = ROW.exec(screen[i])
    if (m && Number(m[1]) === rows.length + 1) rows.push({ n: Number(m[1]), text: m[2], at: i })
  }
  const above = screen.slice(Math.max(0, start - 4), start).map((l) => l.trim()).filter(Boolean)
  return { rows, above }
}

/** The question dialog at the bottom of a terminal, its closing review, or null for anything
 *  else: the input box, a permission prompt, a shell. */
export function questionOnScreen(lines: string[]): Question | Review | null {
  const list = numbered(lines)
  if (!list) return null
  const other = list.rows.find((r) => OTHER.test(r.text))
  if (other) {
    const options = list.rows.filter((r) => r.n < other.n).map(({ n, text }) => ({ n, text }))
    if (!options.length) return null
    const sig = [...list.above, ...options.map((o) => o.text)].join('\n')
    return { kind: 'question', options, other: other.n, multi: options.some((o) => TICK.test(o.text)), sig }
  }
  const submit = list.rows.find((r) => SUBMIT.test(r.text))
  if (submit && !promptOptions(lines)) return { kind: 'review', submit: submit.n, sig: [...list.above, ...list.rows.map((r) => r.text)].join('\n') }
  return null
}

/** Whether the question `q` is still on screen: its lines and options, whatever its "Type
 *  something." row says now. */
export function stillAsking(lines: string[], q: Question): boolean {
  const list = numbered(lines)
  if (!list) return false
  const k = q.options.length
  return list.rows.length >= k && [...list.above, ...list.rows.slice(0, k).map((r) => r.text)].join('\n') === q.sig
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim()

/** Refuses, typing nothing, unless the child says it waits for input. */
async function mustAsk(id: string, d: Deps) {
  const waiting = await d.waitingFor(id)
  if (!waiting?.toLowerCase().includes('input needed'))
    throw new Error(waiting ? `${id} is on a ${waiting}, not a question: nothing was typed` : `${id} is not asking a question now: nothing was typed`)
}

type Screen = { lines(): string[] }

/** The question on screen, once the attach has settled; a prompt or a review refuses it. */
async function questionShown(id: string, s: Screen, until: Until, d: Deps): Promise<Question> {
  const probe = () => {
    if (promptOptions(s.lines())) throw new Error(`${id} is showing a permission prompt, not a question: nothing was typed`)
    const q = questionOnScreen(s.lines())
    if (q?.kind === 'review') throw new Error(`${id}'s question is on its review: submit it in the terminal, nothing was typed`)
    return q
  }
  await until('its question showed', d.timeoutMs, probe)
  await d.sleep(SETTLE_MS)
  const q = await until('its question showed', d.timeoutMs, probe)
  if (q.multi) throw new Error(`${id}'s question takes several answers: tick them in the terminal, nothing was typed`)
  return q
}

/** Waits until question `q` is gone. A review that follows the last of several questions is
 *  submitted: the answers were all given in the card. */
async function movedOn(s: Screen & { write(data: string): Promise<void> }, until: Until, d: Deps, q: Question) {
  await until('the question took the answer', d.stepMs, () => (stillAsking(s.lines(), q) ? null : true))
  // The next screen can take a moment to draw; a review is only looked for, never waited on.
  await d.sleep(SETTLE_MS)
  const next = questionOnScreen(s.lines())
  if (next?.kind !== 'review') return
  await s.write(String(next.submit))
  await until('the answers were submitted', d.stepMs, () => {
    const now = questionOnScreen(s.lines())
    return now?.kind === 'review' && now.sig === next.sig ? null : true
  })
}

/** Picks option `index` (0-based) of the question child `id` is asking. Resolves once the
 *  dialog moved on; rejects with what to do by hand when a guard stops it. */
export async function answerQuestion(id: string, index: number, deps: Partial<Deps> = {}): Promise<void> {
  const d = { ...attachDefaults, ...deps }
  if (!Number.isInteger(index) || index < 0) throw new Error(`no option ${index + 1}`)
  await mustAsk(id, d)
  await attached(id, d, async (s, until) => {
    const q = await questionShown(id, s, until, d)
    const o = q.options[index]
    if (!o) throw new Error(`the question on screen has ${q.options.length} options, not ${index + 1}: nothing was typed`)
    await s.write(String(o.n))
    await movedOn(s, until, d, q)
  })
}

/** Answers the question child `id` is asking in words, through its "Type something." row. */
export async function answerQuestionOther(id: string, text: string, deps: Partial<Deps> = {}): Promise<void> {
  const d = { ...attachDefaults, ...deps }
  const words = answerText(text)
  if (!words) throw new Error('nothing to send')
  await mustAsk(id, d)
  await attached(id, d, async (s, until) => {
    const q = await questionShown(id, s, until, d)
    await s.write(String(q.other))
    await d.sleep(KEY_GAP_MS)
    await s.write(words)
    const want = squash(words).slice(0, 30)
    await until('the words showed in the question', d.stepMs, () => {
      if (!stillAsking(s.lines(), q)) throw new Error(`${id}'s question closed before the words were sent: check it in the terminal`)
      return squash(tail(s.lines(), SCREEN).join(' ')).includes(want) ? true : null
    })
    await d.sleep(SUBMIT_GAP_MS)
    await s.write('\r')
    await movedOn(s, until, d, q)
  })
}
