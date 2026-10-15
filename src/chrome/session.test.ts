import { vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: async () => null, Channel: class {} }))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))

import { learnSession, nextSession, type SessionClient } from './session'
import { createStore } from '../layout/store'
import type { PtyClient } from '../pty/client'

const pty = (): PtyClient => {
  let next = 1
  return { spawn: async () => next++, write: async () => {}, resize: async () => {}, kill: async () => {}, onExit: async () => () => {} }
}

/** A fake process tree: pane id → shell pid 1000 + id; `running[pid]` is the claude under it. */
function tree() {
  const running: Record<number, string | null> = {}
  const client = {
    pid: vi.fn(async (id: number) => 1000 + id),
    session: vi.fn(async (pid: number) => running[pid] ?? null),
  } satisfies SessionClient
  return { running, client }
}

test('nextSession: a live session wins, a learnt one clears when it ends, an opened one waits', () => {
  expect(nextSession(undefined, 'a', false)).toEqual({ sessionId: 'a', learnt: true })
  expect(nextSession('old', 'a', false)).toEqual({ sessionId: 'a', learnt: true })
  expect(nextSession('a', null, true)).toEqual({ sessionId: undefined, learnt: false })
  expect(nextSession('restored', null, false)).toEqual({ sessionId: 'restored', learnt: false })
  expect(nextSession(undefined, null, false)).toEqual({ sessionId: undefined, learnt: false })
})

test('a claude typed by hand is learnt, replaced when another starts, and cleared when it exits', async () => {
  const s = createStore(pty())
  await s.getState().newTab()
  const { running, client } = tree()

  await learnSession(1, client, s)
  expect(s.getState().panes[1].sessionId).toBeUndefined()

  running[1001] = 'sess-1'
  await learnSession(1, client, s)
  expect(s.getState().panes[1].sessionId).toBe('sess-1')

  running[1001] = 'sess-2'
  await learnSession(1, client, s)
  expect(s.getState().panes[1].sessionId).toBe('sess-2')

  running[1001] = null
  await learnSession(1, client, s)
  expect(s.getState().panes[1].sessionId).toBeUndefined()
  // The shell pid is asked once.
  expect(client.pid).toHaveBeenCalledTimes(1)
  expect(client.session).toHaveBeenCalledWith(1001)
})

test('a session the pane was opened with stays until claude shows up, then follows it', async () => {
  const s = createStore(pty())
  await s.getState().openCommandTab('/r', 'claude --resume abc', 'abc')
  const id = s.getState().tabs[0].focused
  const { running, client } = tree()

  await learnSession(id, client, s)
  expect(s.getState().panes[id].sessionId).toBe('abc')

  running[1000 + id] = 'abc'
  await learnSession(id, client, s)
  expect(s.getState().panes[id].sessionId).toBe('abc')
  running[1000 + id] = null
  await learnSession(id, client, s)
  expect(s.getState().panes[id].sessionId).toBeUndefined()
})

test('non-terminal, exited, failed and closed panes are left alone', async () => {
  const s = createStore(pty())
  await s.getState().newTab()
  s.getState().openView('editor', {}, 'tab')
  const editor = s.getState().tabs[1].focused
  const { running, client } = tree()
  running[1000 + editor] = 'x'
  await learnSession(editor, client, s)
  expect(client.pid).not.toHaveBeenCalled()

  s.getState().paneExited(1, 0)
  await learnSession(1, client, s)
  expect(client.pid).not.toHaveBeenCalled()

  // A pane closed while the lookup is out is not resurrected.
  await s.getState().newTab()
  const late = s.getState().tabs[2].focused
  running[1000 + late] = 'late'
  client.session.mockImplementationOnce(async () => {
    s.getState().focusPane(late)
    await s.getState().closePane()
    return 'late'
  })
  await learnSession(late, client, s)
  expect(s.getState().panes[late]).toBeUndefined()

  // No pid (the shell already went away): nothing to walk.
  const none = { pid: vi.fn(async () => null), session: vi.fn(async () => 'y') }
  await s.getState().newTab()
  const gone = s.getState().tabs[2].focused
  await learnSession(gone, none, s)
  expect(none.session).not.toHaveBeenCalled()
  expect(s.getState().panes[gone].sessionId).toBeUndefined()
})
