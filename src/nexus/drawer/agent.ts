import { makeChatPty } from '../../chat-input/pty'
import { promptOnScreen } from '../../cockpit/prompt'
import { paneAgent, type ChatAgent, type PaneSinks } from '../../conversation/agent'
import type { SessionStatus } from '../../conversation/types'
import { waitingKind } from '../../conversation/Face'
import { childStatus } from '../../mission/agent'
import { inputBox } from '../../mission/as-me'
import { questionOnScreen } from '../../mission/ask'
import type { PaneId } from '../../pty/client'
import type { HostedSession } from '../../session/host'
import type { Figure } from './model'

/** How a drawer tab's conversation answers its session: typed into the session's own terminal,
 *  the one drawn under the conversation.
 *
 *  - A pane's session: the pane's PTY, as the pane's own conversation face types into it
 *    (`paneAgent`), each write gated on Claude still running under the pane's shell.
 *  - A child's attach: the attach PTY, with the same keys (`makeChatPty`). That gate cannot serve
 *    here: it looks for a `claude agents` session under the shell, and what runs under an attach's
 *    shell is the `claude attach` client, the session itself running elsewhere. So each write reads
 *    the attach's screen instead, as the mission's hidden attaches do (`src/mission/as-me.ts`),
 *    whose measurements set what is refused: a prompt is typed only into Claude Code's input box
 *    (on a permission prompt, typed letters are dropped and Enter picks "Yes"; on the shell, Enter
 *    would run the prompt), an approval only onto a permission prompt, an option only onto a
 *    question. A child has no shell mode: what it runs is its own business (`src/mission/agent.ts`). */

export type AttachSinks = {
  writePty(pty: PaneId, data: string): Promise<void>
  /** What the attach's terminal view shows now (`readBuffer`), undefined when none is drawn. */
  screen(pty: PaneId): string[] | undefined
  sleep(ms: number): Promise<void>
}

export type AgentSinks = { pane: PaneSinks; attach: AttachSinks }

/** Claude Code's own screen, of any kind: its input box, a permission prompt, a question. */
const claudeShows = (lines: string[]) => inputBox(lines) !== null || promptOnScreen(lines) !== null || questionOnScreen(lines) !== null

/** The agent of the attach drawn on `pty`. Each write reads the screen right before it types,
 *  and rejects, typing nothing, when the screen is not what it answers. Writes run one at a time,
 *  so the screen each one checks is the one its keys land on. */
export function attachAgent(pty: PaneId, s: AttachSinks): ChatAgent {
  /** The screen the write running now answers: why not, or null. */
  let check: (lines: string[]) => string | null = () => null
  const chat = makeChatPty({
    writePty: s.writePty,
    sleep: s.sleep,
    paneRunsClaude: async () => {
      const lines = s.screen(pty) ?? []
      const why = claudeShows(lines) ? check(lines) : 'Claude Code is not on screen in that attach: nothing was sent'
      if (why) throw new Error(why)
      return true
    },
  })
  let queue: Promise<unknown> = Promise.resolve()
  const one = (answers: (lines: string[]) => string | null, write: () => Promise<void>): Promise<void> => {
    const next = queue.catch(() => {}).then(() => {
      check = answers
      return write()
    })
    queue = next
    return next
  }
  const box = (lines: string[]) => {
    const b = inputBox(lines)
    if (!b) return 'It waits on a dialog, not a message: answer that first. Nothing was sent'
    if (b.normal) return 'Its input is in vim NORMAL mode: press i in the terminal first. Nothing was sent'
    return null
  }
  const prompt = (lines: string[]) => (promptOnScreen(lines) ? null : 'No permission prompt is on screen: nothing was sent')
  const question = (lines: string[]) => {
    const q = questionOnScreen(lines)
    if (q?.kind !== 'question') return 'No question is on screen: nothing was sent'
    if (q.multi) return 'It asks for several picks: answer it in the terminal. Nothing was sent'
    return null
  }
  return {
    send: (text) => one(box, () => chat.sendPrompt(pty, text)),
    allow: () => one(prompt, () => chat.answerApproval(pty, true)),
    deny: () => one(prompt, () => chat.answerApproval(pty, false)),
    answer: (index) => one(question, () => chat.answerQuestion(pty, index)),
  }
}

/** The agent of a tab's session, or none while it has no terminal to type into. */
export function sessionAgent(session: Pick<HostedSession, 'kind' | 'pty' | 'error'> | undefined, s: AgentSinks): ChatAgent | undefined {
  if (!session || session.pty === null || session.error) return undefined
  return session.kind === 'pane' ? paneAgent(session.pty, s.pane) : attachAgent(session.pty, s.attach)
}

/** What the snapshot the ship was built from says the figure's session is doing, as the
 *  conversation's foot reads it: a permission or question it waits on gets its card, and any
 *  other dialog the *answer in the terminal* line, never the composer. */
export function statusOf(f: Figure | null): SessionStatus | undefined {
  if (!f) return undefined
  if (f.kind === 'robot') return childStatus(f.robot.child)
  const p = f.captain.parent
  if (!p) return undefined
  const waiting = waitingKind(p.status, p.waiting_for)
  return { busy: p.status === 'busy', waiting, parked: p.status === 'waiting' && waiting === null }
}
