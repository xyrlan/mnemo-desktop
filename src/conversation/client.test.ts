import libRs from '../../src-tauri/src/lib.rs?raw'
import conversationRs from '../../src-tauri/src/conversation.rs?raw'
import usageRs from '../../src-tauri/src/usage.rs?raw'
import { makeConversationClient, type ChannelLike } from './client'
import type { FollowEvent } from './types'

test('every command the client invokes is registered in lib.rs and defined in its module', async () => {
  const block = (name: string) => [...new RegExp(`// -- ${name} commands --([^/]*)`).exec(libRs)![1].matchAll(/\w+::(\w+)/g)].map((m) => m[1])
  const registered = [...block('conversation'), ...block('usage')]
  const invoked: string[] = []
  const c = makeConversationClient(
    async <T,>(cmd: string) => (invoked.push(cmd), 7 as T),
    () => ({ onmessage: () => {} }),
  )
  const stop = await c.follow('s', '/r', 200, () => {})
  stop()
  await c.earlier('s', '/r', 10, 5)
  await c.logUsage({ event: 'face' })
  expect(registered.sort()).toEqual([...new Set(invoked)].sort())
  for (const cmd of ['conversation_follow', 'conversation_unfollow', 'conversation_earlier']) expect(conversationRs).toContain(`pub fn ${cmd}(`)
  expect(usageRs).toContain('pub fn usage_log(')
})

test('follow hands the core a channel whose messages reach the callback, and unfollows by the id it got', async () => {
  const calls: [string, Record<string, unknown> | undefined][] = []
  let ch: ChannelLike<FollowEvent> | undefined
  const c = makeConversationClient(
    async <T,>(cmd: string, args?: Record<string, unknown>) => (calls.push([cmd, args]), 42 as T),
    <T,>() => (ch = { onmessage: () => {} } as unknown as ChannelLike<FollowEvent>) as unknown as ChannelLike<T>,
  )
  const got: FollowEvent[] = []
  const stop = await c.follow('sid', '/repo', 200, (e) => got.push(e))
  expect(calls[0][0]).toBe('conversation_follow')
  expect(calls[0][1]).toMatchObject({ sessionId: 'sid', cwd: '/repo', tail: 200, onEvent: ch })
  ch!.onmessage({ kind: 'missing' })
  expect(got).toEqual([{ kind: 'missing' }])
  stop()
  expect(calls[1]).toEqual(['conversation_unfollow', { id: 42 }])
})

test('a Claude follow asks the core exactly as before; a Grok one names its kind and home', async () => {
  const calls: [string, Record<string, unknown> | undefined][] = []
  const c = makeConversationClient(
    async <T,>(cmd: string, args?: Record<string, unknown>) => (calls.push([cmd, args]), 1 as T),
    () => ({ onmessage: () => {} }),
  )
  await c.follow('sid', '/repo', 200, () => {})
  await c.follow('sid', '/repo', 200, () => {}, { kind: 'claude', home: '/Users/you/.claude-work' })
  await c.earlier('sid', '/repo', 10, 5)
  await c.earlier('sid', '/repo', 10, 5, { kind: 'claude' })
  const keys = calls.map(([, a]) => Object.keys(a!).sort())
  expect(keys).toEqual([
    ['cwd', 'onEvent', 'sessionId', 'tail'],
    ['cwd', 'onEvent', 'sessionId', 'tail'],
    ['before', 'count', 'cwd', 'sessionId'],
    ['before', 'count', 'cwd', 'sessionId'],
  ])
  calls.length = 0
  await c.follow('gid', '/repo', 200, () => {}, { kind: 'grok', home: '/Users/you/.grok-work' })
  await c.earlier('gid', '/repo', 10, 5, { kind: 'grok' })
  expect(calls[0][1]).toMatchObject({ sessionId: 'gid', cwd: '/repo', tail: 200, kind: 'grok', home: '/Users/you/.grok-work' })
  // No home: every Grok home is searched (`conversation_earlier`'s `home: None`).
  expect(calls[1][1]).toEqual({ sessionId: 'gid', cwd: '/repo', before: 10, count: 5, kind: 'grok', home: null })
})
