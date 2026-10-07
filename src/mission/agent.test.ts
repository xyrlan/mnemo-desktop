import { vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => null) }))

import { childAgent, childStatus, routeStore, setRoute } from './agent'
import { missionStore } from './app-store'
import { snapshot } from './fixtures'
import { allChildren, type ChildSession } from './types'
import type { Answer, Choice } from '../cockpit/approve'

const [first] = allChildren(snapshot)

beforeEach(() => {
  missionStore.setState({ snapshot, drafts: {}, replyErrors: {} })
  routeStore.setState({ routes: {} })
})

test('childAgent answers the dialog through the question routes and the prompt through answerPrompt, with the latest child', async () => {
  const calls: unknown[][] = []
  const agent = childAgent(first, {
    answerPrompt: async (c: ChildSession, choice: Choice): Promise<Answer> => {
      calls.push(['prompt', c.cwd, choice])
      return { choice, phase: 'sent', pane: 3, at: 0 }
    },
    // The child itself, as the latest snapshot has it: its attach runs on its account.
    answerQuestion: async (c, index) => void calls.push(['answer', typeof c === 'string' ? c : (c as ChildSession).cwd, index]),
    answerQuestionOther: async (c, text) => void calls.push(['other', typeof c === 'string' ? c : (c as ChildSession).cwd, text]),
  })
  // The snapshot moved on since the agent was made: the prompt is answered where the child is now.
  const moved = { ...first, cwd: '/moved' }
  const swap = (c: ChildSession) => (c.id === first.id ? moved : c)
  missionStore.setState({
    snapshot: {
      ...snapshot,
      repos: snapshot.repos.map((r) => ({
        ...r,
        children: r.children.map(swap),
        missions: r.missions.map((m) => ({ ...m, pieces: m.pieces.map((p) => ({ ...p, child: p.child && swap(p.child) })) })),
      })),
    },
  })
  await agent.allow()
  await agent.deny()
  await agent.answer(2)
  await agent.other!('purple')
  expect(calls).toEqual([
    ['prompt', '/moved', 'yes'],
    ['prompt', '/moved', 'no'],
    ['answer', '/moved', 2],
    ['other', '/moved', 'purple'],
  ])
  expect(agent.bash).toBeUndefined()
})

test('a prompt answer that did not go through rejects with why', async () => {
  const agent = childAgent(first, { answerPrompt: async (_c, choice) => ({ choice, phase: 'error', pane: null, error: 'no attach', at: 0 }) })
  await expect(agent.allow()).rejects.toThrow('no attach')
})

test('send goes as me by default and as a message once that route is picked', async () => {
  const sent: string[] = []
  const real = { replyAsMe: missionStore.getState().replyAsMe, sendReply: missionStore.getState().sendReply }
  missionStore.setState({
    replyAsMe: async (id) => (sent.push(`as-me:${missionStore.getState().drafts[id]}`), true),
    sendReply: async (id) => (sent.push(`message:${missionStore.getState().drafts[id]}`), true),
  })
  try {
    const agent = childAgent(first)
    await agent.send('one')
    setRoute(first.id, 'message')
    await agent.send('two')
    expect(sent).toEqual(['as-me:one', 'message:two'])
  } finally {
    missionStore.setState(real)
  }
})

test('childStatus: a stopped child waits on nothing, whatever it was last parked on', () => {
  expect(childStatus({ ...first, live: false, tempo: 'blocked', waiting_for: 'permission prompt' })).toEqual({ busy: false, waiting: null })
  expect(childStatus({ ...first, tempo: 'stalled', waiting_for: null })).toEqual({ busy: false, waiting: null })
})
