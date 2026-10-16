import { invoke as tauriInvoke, Channel } from '@tauri-apps/api/core'
import type { Chunk, FollowEvent, FollowSource } from './types'

export type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>
/** A Tauri `Channel`, or a fake in tests: `onmessage` is set before it is handed to the core. */
export type ChannelLike<T> = { onmessage: (m: T) => void }

/** What a follow names beside the session: nothing for a Claude transcript, so the core is asked
 *  exactly as before Grok; a Grok session's kind and its home (null: every Grok home). */
export function sourceArgs(source: FollowSource | undefined): Record<string, unknown> {
  return source?.kind === 'grok' ? { kind: 'grok', home: source.home ?? null } : {}
}

export interface ConversationClient {
  /** Streams the transcript of `sessionId` (found under `cwd`'s project dir, else by scanning
   *  every project; a Grok session's history in its `source` home): first the last `tail`
   *  complete lines, then every line appended, until the returned function is called. */
  follow(sessionId: string, cwd: string, tail: number, onEvent: (e: FollowEvent) => void, source?: FollowSource): Promise<() => void>
  /** The `count` complete lines that end right before byte `before` ("load earlier"). */
  earlier(sessionId: string, cwd: string, before: number, count: number, source?: FollowSource): Promise<Chunk>
  /** Appends one row to `~/.mnemo-desktop/usage.jsonl` (face toggles and heartbeats, Q8). */
  logUsage(row: Record<string, unknown>): Promise<void>
}

export function makeConversationClient(invoke: Invoke, channel: <T>() => ChannelLike<T> = () => new Channel() as never): ConversationClient {
  return {
    async follow(sessionId, cwd, tail, onEvent, source) {
      const ch = channel<FollowEvent>()
      ch.onmessage = onEvent
      const id = await invoke<number>('conversation_follow', { sessionId, cwd, tail, onEvent: ch, ...sourceArgs(source) })
      return () => void invoke('conversation_unfollow', { id })
    },
    earlier: (sessionId, cwd, before, count, source) => invoke<Chunk>('conversation_earlier', { sessionId, cwd, before, count, ...sourceArgs(source) }),
    logUsage: (row) => invoke('usage_log', { row }),
  }
}

export const tauriConversation = makeConversationClient(tauriInvoke as Invoke)
