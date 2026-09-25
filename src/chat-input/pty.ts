// adapted from stablyai/orca src/renderer/src/components/native-chat/native-chat-runtime-send.ts,
// native-chat-send.ts, native-chat-pty-send-queue.ts and native-chat-interactive-prompt.ts
import { invoke } from '@tauri-apps/api/core'
import { pasteOf } from '../browser/grab-agent'
import { ptyPid, tauriPty } from '../pty/client'

/** How a prompt, a shell command, an approval and an answer are typed into a live Claude Code
 *  TUI. Every key below was checked against Claude Code 2.1.282 in a real pty (2026-09-25, the
 *  numbers are in the chat-send PR):
 *
 *  - clearing the line: Ctrl+U empties what was left typed, and a Backspace after it leaves the
 *    shell mode a leftover `!` put the line in (Ctrl+U alone keeps it: the prompt then ran as a
 *    command). Each needs a read of its own: Ctrl+U read with the paste after it lands inside it;
 *  - a prompt: always one bracketed paste, Enter in the same write. The paste's end marker closes
 *    it, so no wait is needed; typed bare, a line of 150 characters or more reads as a paste
 *    and swallows an Enter sent less than ~100 ms after it;
 *  - a shell command: `!` alone, then the command pasted and Enter. `!` read with the paste
 *    after it types the command twice;
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
/** On the emptied line: leaves shell mode, and does nothing otherwise. */
export const BACKSPACE = '\x7f'
/** Typed alone on an empty line, puts the input in shell mode. */
export const BANG = '!'
export const ENTER = '\r'
export const ESC = '\x1b'
/** Between the keys of a prompt or a shell command, so each is read on its own. In the probes
 *  20 ms was enough idle and 30 while Claude streamed a reply; 50 keeps a margin. */
export const SEND_GAP_MS = 50
/** Between the words of a question's "Type something." row and its Enter (Orca's measured submit
 *  delay; not probed again). */
export const SUBMIT_GAP_MS = 500
/** Between the key that opens that row and the words. */
export const KEY_GAP_MS = 150

/** What reaches the input line for `text`: one bracketed paste, its control characters dropped
 *  so the text cannot press keys or end the paste early. */
export function promptBytes(text: string): string {
  return pasteOf(text.replace(/\r\n?/g, '\n'))
}

/** Whether `promptBytes` would paste anything but blanks. */
const blank = (text: string) => !text.replace(/[\x00-\x20\x7f]/g, '')

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
  /** Runs `command` in Claude Code's shell mode (`!`): its output goes into the transcript. */
  sendBash(pane: number, command: string): Promise<void>
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

  /** Empties the input line and leaves shell mode, each key read on its own. */
  const clear = async (pane: number) => {
    await s.writePty(pane, CLEAR_LINE)
    await s.sleep(SEND_GAP_MS)
    await s.writePty(pane, BACKSPACE)
    await s.sleep(SEND_GAP_MS)
  }

  return {
    sendPrompt(pane, text) {
      if (blank(text)) return Promise.reject(new Error('nothing to send'))
      return guarded(pane, async () => {
        await clear(pane)
        await s.writePty(pane, promptBytes(text) + ENTER)
      })
    },
    sendBash(pane, command) {
      if (blank(command)) return Promise.reject(new Error('nothing to run'))
      return guarded(pane, async () => {
        await clear(pane)
        await s.writePty(pane, BANG)
        await s.sleep(SEND_GAP_MS)
        await s.writePty(pane, promptBytes(command) + ENTER)
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
/** Runs `command` in pane `pane`'s Claude as a `!` shell command. */
export const ptySendBash = (pane: number, command: string): Promise<void> => chatPty.sendBash(pane, command)
/** Answers the permission prompt pane `pane`'s Claude is showing: allow, or deny. */
export const ptyAnswerApproval = (pane: number, allow: boolean): Promise<void> => chatPty.answerApproval(pane, allow)
/** Picks option `index` (0-based) of the question pane `pane`'s Claude is asking. */
export const ptyAnswerQuestion = (pane: number, index: number): Promise<void> => chatPty.answerQuestion(pane, index)
/** Answers that question in words; `optionCount` is how many options it offered. */
export const ptyAnswerQuestionOther = (pane: number, optionCount: number, text: string): Promise<void> =>
  chatPty.answerQuestionOther(pane, optionCount, text)
