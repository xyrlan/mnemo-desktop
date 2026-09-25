import { createContext, type ComponentType } from 'react'

/** The chat-input piece (`src/chat-input/`, wave E): the composer, the approval and question
 *  cards, and how each is typed into a live Claude Code TUI. It lands beside this one, so it is
 *  reached through `import.meta.glob`: with its files missing the glob finds nothing and the
 *  foot draws only what it can without them; once they merge, they wire themselves. */

export type ComposerProps = { onSend(text: string): Promise<void>; cwd: string | null; placeholder?: string; disabled?: boolean }
export type ApprovalCardProps = { tool: string; summary: string; detail?: string; onAllow(): Promise<void>; onDeny(): Promise<void> }
export type QuestionCardProps = { question: string; options: string[]; onAnswer(index: number): Promise<void>; onOther?(text: string): Promise<void> }

export type ChatInputParts = {
  Composer?: ComponentType<ComposerProps>
  ApprovalCard?: ComponentType<ApprovalCardProps>
  QuestionCard?: ComponentType<QuestionCardProps>
}

export type ChatInputPty = {
  ptySendPrompt?(pane: number, text: string): Promise<void>
  ptyAnswerApproval?(pane: number, allow: boolean): Promise<void>
  ptyAnswerQuestion?(pane: number, index: number): Promise<void>
}

const one = <T>(mods: Record<string, T>): T | undefined => Object.values(mods)[0]

const composer = one(import.meta.glob<{ ChatComposer?: ComponentType<ComposerProps> }>('../chat-input/Composer.tsx', { eager: true }))
const approval = one(import.meta.glob<{ ApprovalCard?: ComponentType<ApprovalCardProps> }>('../chat-input/ApprovalCard.tsx', { eager: true }))
const question = one(import.meta.glob<{ QuestionCard?: ComponentType<QuestionCardProps> }>('../chat-input/QuestionCard.tsx', { eager: true }))

export const chatInputParts: ChatInputParts = {
  Composer: composer?.ChatComposer,
  ApprovalCard: approval?.ApprovalCard,
  QuestionCard: question?.QuestionCard,
}

export const chatInputPty: ChatInputPty = one(import.meta.glob<ChatInputPty>('../chat-input/pty.ts', { eager: true })) ?? {}

/** The parts the foot draws with: chat-input's, or a test's stand-ins. */
export const ChatInputContext = createContext<ChatInputParts>(chatInputParts)
