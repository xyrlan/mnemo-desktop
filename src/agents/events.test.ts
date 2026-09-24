import { beforeEach, expect, test, vi } from 'vitest'

type Handler = (e: { payload: unknown }) => void
const listeners: Array<{ name: string; handler: Handler; unlisten: ReturnType<typeof vi.fn> }> = []
let release: (() => void) | undefined
vi.mock('@tauri-apps/api/event', () => ({
  listen: (name: string, handler: Handler) => {
    const unlisten = vi.fn()
    listeners.push({ name, handler, unlisten })
    // Held until the test lets it go, as a real `listen` resolves after an IPC round trip.
    return new Promise<() => void>((resolve) => {
      release = () => resolve(unlisten)
    })
  },
}))
const invoke = vi.fn(async () => undefined)
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...(a as [])) }))

import { AGENT_EVENT, parseAgentEvent, subscribeAgentEvents, type AgentEvent } from './events'
import { notifyAgent } from './notify'

const flush = () => new Promise((r) => setTimeout(r, 0))
const stop: AgentEvent = { sessionId: 's1', cwd: '/r', kind: 'stop', at: 42 }

beforeEach(() => {
  listeners.length = 0
  release = undefined
})

test('each agent event reaches the callback, parsed, until it unsubscribes', async () => {
  const seen: AgentEvent[] = []
  const off = subscribeAgentEvents((e) => seen.push(e))
  expect(listeners.map((l) => l.name)).toEqual([AGENT_EVENT])
  release!()
  await flush()
  listeners[0].handler({ payload: stop })
  listeners[0].handler({ payload: { ...stop, kind: 'notification', message: 'Claude needs your permission to use Bash' } })
  listeners[0].handler({ payload: { nope: 1 } })
  expect(seen).toEqual([stop, { ...stop, kind: 'notification', message: 'Claude needs your permission to use Bash' }])
  off()
  expect(listeners[0].unlisten).toHaveBeenCalledOnce()
  listeners[0].handler({ payload: stop })
  expect(seen).toHaveLength(2)
  off()
  expect(listeners[0].unlisten).toHaveBeenCalledOnce()
})

test('unsubscribing before the listener is up still releases it, and nothing arrives', async () => {
  const cb = vi.fn()
  const off = subscribeAgentEvents(cb)
  off()
  listeners[0].handler({ payload: stop })
  release!()
  await flush()
  expect(listeners[0].unlisten).toHaveBeenCalledOnce()
  expect(cb).not.toHaveBeenCalled()
})

test('two subscribers each get the event', async () => {
  const a = vi.fn()
  const b = vi.fn()
  subscribeAgentEvents(a)
  subscribeAgentEvents(b)
  for (const l of listeners) l.handler({ payload: stop })
  expect(a).toHaveBeenCalledWith(stop)
  expect(b).toHaveBeenCalledWith(stop)
})

test('parseAgentEvent keeps a well-formed event and refuses the rest', () => {
  expect(parseAgentEvent(stop)).toEqual(stop)
  expect(parseAgentEvent({ ...stop, message: 'hi', extra: 1 })).toEqual({ ...stop, message: 'hi' })
  for (const kind of ['start', 'prompt', 'stop', 'notification', 'end']) expect(parseAgentEvent({ ...stop, kind })?.kind).toBe(kind)
  expect(parseAgentEvent({ ...stop, kind: 'pretooluse' })).toBeNull()
  expect(parseAgentEvent({ ...stop, sessionId: '' })).toBeNull()
  expect(parseAgentEvent({ ...stop, cwd: undefined })).toBeNull()
  expect(parseAgentEvent({ ...stop, at: '42' })).toBeNull()
  expect(parseAgentEvent({ ...stop, at: Number.NaN })).toBeNull()
  expect(parseAgentEvent({ ...stop, message: 3 })).toEqual(stop)
  expect(parseAgentEvent(null)).toBeNull()
  expect(parseAgentEvent('stop')).toBeNull()
})

test('notifyAgent asks Rust for a native notification', async () => {
  await notifyAgent('mnemo-desktop', 'Claude is waiting for you')
  expect(invoke).toHaveBeenCalledWith('agent_notify', { title: 'mnemo-desktop', body: 'Claude is waiting for you' })
  invoke.mockRejectedValueOnce(new Error('denied'))
  await expect(notifyAgent('t', 'b')).rejects.toThrow('denied')
})
