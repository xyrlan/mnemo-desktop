import { invoke as tauriInvoke, Channel } from '@tauri-apps/api/core'
import type { Chunk, FollowEvent } from './types'

export type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>
/** A Tauri `Channel`, or a fake in tests: `onmessage` is set before it is handed to the core. */
export type ChannelLike<T> = { onmessage: (m: T) => void }

export interface ConversationClient {
  /** Streams the transcript of `sessionId` (found under `cwd`'s project dir, else by scanning
   *  every project): first the last `tail` complete lines, then every line appended, until the
   *  returned function is called. */
  follow(sessionId: string, cwd: string, tail: number, onEvent: (e: FollowEvent) => void): Promise<() => void>
  /** The `count` complete lines that end right before byte `before` ("load earlier"). */
  earlier(sessionId: string, cwd: string, before: number, count: number): Promise<Chunk>
  /** Appends one row to `~/.mnemo-desktop/usage.jsonl` (face toggles and heartbeats, Q8). */
  logUsage(row: Record<string, unknown>): Promise<void>
}

export function makeConversationClient(invoke: Invoke, channel: <T>() => ChannelLike<T> = () => new Channel() as never): ConversationClient {
  return {
    async follow(sessionId, cwd, tail, onEvent) {
      const ch = channel<FollowEvent>()
      ch.onmessage = onEvent
      const id = await invoke<number>('conversation_follow', { sessionId, cwd, tail, onEvent: ch })
      return () => void invoke('conversation_unfollow', { id })
    },
    earlier: (sessionId, cwd, before, count) => invoke<Chunk>('conversation_earlier', { sessionId, cwd, before, count }),
    logUsage: (row) => invoke('usage_log', { row }),
  }
}

export const tauriConversation = makeConversationClient(tauriInvoke as Invoke)
