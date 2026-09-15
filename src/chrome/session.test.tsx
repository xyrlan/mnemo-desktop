import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: async () => null, Channel: class {} }))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))

import PaneBar from './PaneBar'
import { learnSession, nextSession, SESSION_POLL_MS, type SessionClient } from './session'
import type { ChromeClient } from './client'
import { createStore } from '../layout/store'
import { store as appStore } from '../layout/app-store'
import { missionStore } from '../mission/app-store'
import { snapshot } from '../mission/fixtures'
import type { PtyClient } from '../pty/client'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

describe('PaneBar', () => {
  let host: HTMLDivElement
  let root: Root
  const git: ChromeClient = { repo: async () => null, branch: async () => null }

  beforeEach(() => {
    vi.useFakeTimers()
    missionStore.setState({ snapshot })
    appStore.setState({ tabs: [{ id: 't', root: { kind: 'leaf', pane: 41 }, focused: 41 }], activeTab: 't', panes: { 41: { id: 41, view: 'terminal', cwd: '/tmp' } } })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.useRealTimers()
  })

  test('polls a terminal pane for its session and writes it to the layout store', async () => {
    const { running, client } = tree()
    await act(async () => root.render(<PaneBar id={41} client={git} sessions={client} />))
    expect(client.session).toHaveBeenCalledTimes(1)
    expect(appStore.getState().panes[41].sessionId).toBeUndefined()

    running[1041] = 'typed'
    await act(async () => vi.advanceTimersByTime(SESSION_POLL_MS))
    expect(appStore.getState().panes[41].sessionId).toBe('typed')

    // The shell exits: polling stops.
    await act(async () => appStore.getState().paneExited(41, 0))
    const calls = client.session.mock.calls.length
    await act(async () => vi.advanceTimersByTime(SESSION_POLL_MS * 3))
    expect(client.session).toHaveBeenCalledTimes(calls)
  })
})
