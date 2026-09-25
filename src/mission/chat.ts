import type { JSX } from 'react'

/** The chat's composer and approval card, from the chat-input piece (orca-redesign-e), reached
 *  through `import.meta.glob` so this pane builds before that piece lands and wires itself when
 *  it does. Until then `chatParts()` is null and the pane keeps its own reply box (`rows.tsx`).
 *  Tests mock this module to hand in stand-ins. */

export type ChatComposerProps = { onSend(text: string): Promise<void>; cwd: string | null; placeholder?: string; disabled?: boolean }
export type ApprovalCardProps = { tool: string; summary: string; detail?: string; onAllow(): Promise<void>; onDeny(): Promise<void> }

export type ChatParts = {
  ChatComposer: (props: ChatComposerProps) => JSX.Element
  ApprovalCard: (props: ApprovalCardProps) => JSX.Element
}

const composer = Object.values(import.meta.glob<{ ChatComposer?: ChatParts['ChatComposer'] }>('../chat-input/Composer.tsx', { eager: true }))[0]
const approval = Object.values(import.meta.glob<{ ApprovalCard?: ChatParts['ApprovalCard'] }>('../chat-input/ApprovalCard.tsx', { eager: true }))[0]

const parts: ChatParts | null = composer?.ChatComposer && approval?.ApprovalCard ? { ChatComposer: composer.ChatComposer, ApprovalCard: approval.ApprovalCard } : null

export function chatParts(): ChatParts | null {
  return parts
}
