// adapted from stablyai/orca src/renderer/src/components/native-chat/native-chat-runtime-send.ts,
// native-chat-send.ts, native-chat-pty-send-queue.ts and native-chat-interactive-prompt.ts
import { invoke } from '@tauri-apps/api/core'
import { pasteOf } from '../browser/grab-agent'
import { ptyPid, tauriPty } from '../pty/client'

/** How a prompt, an approval and an answer are typed into a live Claude Code TUI. Every key
 *  below was checked against Claude Code 2.1.282 in a real pty (2026-09-24):
 *
 *  - a prompt: Ctrl+U empties whatever was left typed on the input line, a moment later the
 *    text goes in (one bracketed paste when it spans lines, so the newlines stay inside the
 *    turn), and Enter follows as a write of its own: an Enter in the same write as a paste
 *    lands inside it;
 *  - a permission prompt: `1` picks "Yes", Esc is "No, and tell Claude what to do differently";
 *  - an AskUserQuestion: the option's digit answers it outright; answering in words is the
 *    digit of the "Type something." row that follows the options, the words, then Enter.
 *
 *  Nothing is typed unless the pane still runs Claude: the caller's picture of the session may be
 *  seconds old, and keys meant for Claude, Enter above all, would run in the shell under it. */

export type PtySinks = {
  writePty(pane: number, data: string): Promise<void>
  /** Whether the pane's shell still has Claude Code under it, asked now. */
  paneRunsClaude(pane: number): Promise<boolean>
  sleep(ms: number): Promise<void>
}

/** Kill-to-start-of-line in Claude Code's input (vim mode's insert state too). */
export const CLEAR_LINE = '\x15'
export const ENTER = '\r'
export const ESC = '\x1b'
/** Between the prompt's text and its Enter: less and a busy TUI takes the Enter as part of the
 *  paste (Orca's measured submit delay). */
export const SUBMIT_GAP_MS = 500
/** Between two keys that change what the TUI shows, so the second lands on the new screen. */
export const KEY_GAP_MS = 150

/** What reaches the input line for `text`: bare on one line, a bracketed paste over several.
 *  Control characters are dropped either way, so the text cannot press keys. */
export function promptBytes(text: string): string {
  const clean = text.replace(/\r\n?/g, '\n')
  if (clean.includes('\n')) return pasteOf(clean)
  return clean.replace(/\t/g, ' ').replace(/[\x00-\x1f\x7f]/g, '')
}

/** The key that picks option `index` (0-based) of a question: its number, 1 to 9. */
export function optionKey(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index > 8) throw new Error(`no key picks option ${index + 1}: Claude numbers them 1 to 9`)
  return String(index + 1)
}

/** One line of words for a question's "Type something." row: it takes no newlines. */
export const answerText = (text: string) =>
  text
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim()

export type ChatPty = {
  sendPrompt(pane: number, text: string): Promise<void>
  answerApproval(pane: number, allow: boolean): Promise<void>
  answerQuestion(pane: number, index: number): Promise<void>
  /** Answers in words: `optionCount` is how many options the question offered. */
  answerQuestionOther(pane: number, optionCount: number, text: string): Promise<void>
}

export function makeChatPty(s: PtySinks): ChatPty {
  // One sequence per pane at a time: a second send's text must not land between the first's
  // text and its Enter.
  const queues = new Map<number, Promise<unknown>>()
  const serial = (pane: number, run: () => Promise<void>): Promise<void> => {
    const next = (queues.get(pane) ?? Promise.resolve()).catch(() => {}).then(run)
    queues.set(pane, next)
    const drop = () => {
      if (queues.get(pane) === next) queues.delete(pane)
    }
    next.then(drop, drop)
    return next
  }
  const guarded = (pane: number, keys: () => Promise<void>) =>
    serial(pane, async () => {
      if (!(await s.paneRunsClaude(pane))) throw new Error('Claude is no longer running in that terminal: nothing was sent')
      await keys()
    })

  return {
    sendPrompt(pane, text) {
      const body = promptBytes(text)
      if (!body.trim()) return Promise.reject(new Error('nothing to send'))
      return guarded(pane, async () => {
        await s.writePty(pane, CLEAR_LINE)
        // Read in one burst with the text, the Ctrl+U is lost and the text lands after what was
        // left on the line (2.1.282).
        await s.sleep(KEY_GAP_MS)
        await s.writePty(pane, body)
        await s.sleep(SUBMIT_GAP_MS)
        await s.writePty(pane, ENTER)
      })
    },
    answerApproval: (pane, allow) => guarded(pane, () => s.writePty(pane, allow ? '1' : ESC)),
    answerQuestion(pane, index) {
      let key: string
      try {
        key = optionKey(index)
      } catch (e) {
        return Promise.reject(e)
      }
      return guarded(pane, () => s.writePty(pane, key))
    },
    answerQuestionOther(pane, optionCount, text) {
      const words = answerText(text)
      if (!words) return Promise.reject(new Error('nothing to send'))
      let key: string
      try {
        key = optionKey(optionCount)
      } catch (e) {
        return Promise.reject(e)
      }
      return guarded(pane, async () => {
        await s.writePty(pane, key)
        await s.sleep(KEY_GAP_MS)
        await s.writePty(pane, words)
        await s.sleep(SUBMIT_GAP_MS)
        await s.writePty(pane, ENTER)
      })
    },
  }
}

/** The app's terminals, asked the way Design Mode asks (`src/browser/design-live.ts`). */
export const chatPty = makeChatPty({
  writePty: (pane, data) => tauriPty.write(pane, data),
  paneRunsClaude: async (pane) => {
    const pid = await ptyPid(pane).catch(() => null)
    return pid !== null && (await invoke<boolean>('chrome_claude_running', { panePid: pid }).catch(() => false))
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
})

/** Types `text` into pane `pane`'s Claude as a prompt and submits it. */
export const ptySendPrompt = (pane: number, text: string): Promise<void> => chatPty.sendPrompt(pane, text)
/** Answers the permission prompt pane `pane`'s Claude is showing: allow, or deny. */
export const ptyAnswerApproval = (pane: number, allow: boolean): Promise<void> => chatPty.answerApproval(pane, allow)
/** Picks option `index` (0-based) of the question pane `pane`'s Claude is asking. */
export const ptyAnswerQuestion = (pane: number, index: number): Promise<void> => chatPty.answerQuestion(pane, index)
/** Answers that question in words; `optionCount` is how many options it offered. */
export const ptyAnswerQuestionOther = (pane: number, optionCount: number, text: string): Promise<void> =>
  chatPty.answerQuestionOther(pane, optionCount, text)
