import { invoke } from '@tauri-apps/api/core'
import { ptyPid } from '../pty/client'
import { chatInputPty } from './chat-input'

/** How the chat's foot answers the session it shows: a prompt from the composer, a permission
 *  from the approval card, an option (or words) from the question card. A pane types them into
 *  its PTY; a dispatched child could route them through its mission instead. Each rejects with
 *  what went wrong when nothing was delivered. */
export type ChatAgent = {
  send(text: string): Promise<void>
  allow(): Promise<void>
  deny(): Promise<void>
  answer(index: number): Promise<void>
  /** An answer in words, when this agent can take one. */
  other?(text: string): Promise<void>
}

/** What a pane's agent writes through. `runsClaude` is asked before every write. */
export type PaneSinks = {
  runsClaude(pane: number): Promise<boolean>
  sendPrompt(pane: number, text: string): Promise<void>
  answerApproval(pane: number, allow: boolean): Promise<void>
  answerQuestion(pane: number, index: number): Promise<void>
}

export const NOT_RUNNING = 'Claude is no longer running in this terminal: nothing was sent'

/** The agent of terminal pane `pane`, guarded as Design Mode's delivery is: the status the view
 *  shows may be seconds old, and once Claude Code has exited, what the chat types would run in
 *  the shell (a prompt's Enter runs it; an approval's `1` is a command). So nothing is typed
 *  unless the pane still runs Claude, asked right before the write. */
export function paneAgent(pane: number, s: PaneSinks): ChatAgent {
  const guarded =
    <A extends unknown[]>(write: (...a: A) => Promise<void>) =>
    async (...a: A) => {
      if (!(await s.runsClaude(pane).catch(() => false))) throw new Error(NOT_RUNNING)
      await write(...a)
    }
  return {
    send: guarded((text: string) => s.sendPrompt(pane, text)),
    allow: guarded(() => s.answerApproval(pane, true)),
    deny: guarded(() => s.answerApproval(pane, false)),
    answer: guarded((index: number) => s.answerQuestion(pane, index)),
  }
}

const missing = (what: string) => Promise.reject(new Error(`${what} is not in this build yet`))

/** The app's own: the pane's shell pid, the process-tree check Design Mode uses, and
 *  chat-input's keystrokes. */
export const tauriPaneSinks: PaneSinks = {
  runsClaude: async (pane) => {
    const pid = await ptyPid(pane).catch(() => null)
    return pid !== null && (await invoke<boolean>('chrome_claude_running', { panePid: pid }).catch(() => false))
  },
  sendPrompt: (pane, text) => chatInputPty.ptySendPrompt?.(pane, text) ?? missing('Sending a prompt'),
  answerApproval: (pane, allow) => chatInputPty.ptyAnswerApproval?.(pane, allow) ?? missing('Answering a permission'),
  answerQuestion: (pane, index) => chatInputPty.ptyAnswerQuestion?.(pane, index) ?? missing('Answering a question'),
}
