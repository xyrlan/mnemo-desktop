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
  /** A command run in Claude Code's shell mode (`!`), when this agent has one: a pane's Claude
   *  does, a child answering through its mission does not. */
  bash?(command: string): Promise<void>
}

/** What a pane's agent writes through. Each write checks, right before it types, that the pane
 *  still runs Claude, and rejects, typing nothing, when it does not. */
export type PaneSinks = {
  sendPrompt(pane: number, text: string): Promise<void>
  sendBash(pane: number, command: string): Promise<void>
  answerApproval(pane: number, allow: boolean): Promise<void>
  answerQuestion(pane: number, index: number): Promise<void>
}

/** The agent of terminal pane `pane`. The status the view shows may be seconds old, and once
 *  Claude Code has exited, what the chat types would run in the shell (a prompt's Enter runs it;
 *  an approval's `1` is a command), so every write is guarded. The guard is the sinks' own, asked
 *  once per write inside the pane's queue of keystrokes (`makeChatPty`): asked here as well, a
 *  send paid for the check twice. */
export function paneAgent(pane: number, s: PaneSinks): ChatAgent {
  return {
    send: (text) => s.sendPrompt(pane, text),
    bash: (command) => s.sendBash(pane, command),
    allow: () => s.answerApproval(pane, true),
    deny: () => s.answerApproval(pane, false),
    answer: (index) => s.answerQuestion(pane, index),
  }
}

const missing = (what: string) => Promise.reject(new Error(`${what} is not in this build yet`))

/** The app's own: chat-input's keystrokes, each guarded by the process-tree check Design Mode
 *  uses (`chrome_claude_running`). */
export const tauriPaneSinks: PaneSinks = {
  sendPrompt: (pane, text) => chatInputPty.ptySendPrompt?.(pane, text) ?? missing('Sending a prompt'),
  sendBash: (pane, command) => chatInputPty.ptySendBash?.(pane, command) ?? missing('Running a shell command'),
  answerApproval: (pane, allow) => chatInputPty.ptyAnswerApproval?.(pane, allow) ?? missing('Answering a permission'),
  answerQuestion: (pane, index) => chatInputPty.ptyAnswerQuestion?.(pane, index) ?? missing('Answering a question'),
}
