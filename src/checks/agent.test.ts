import { expect, test } from 'vitest'
import type { AgentNode, RepoNode, WorktreeNode } from '../fleet/types'
import type { ChildSession } from '../mission/types'
import type { Where } from '../browser/grab-agent'
import { destinationOf, noAgent, sendToAgent, START_TIMEOUT_MS, type AgentDeps } from './agent'

const WT = '/code/app-wt-checks'
const agent = (over: Partial<AgentNode>): AgentNode => ({ sessionId: 's1', paneId: 7, state: 'idle', waitingFor: null, title: 'fix the checks', since: 0, ...over })
const tree = (agents: AgentNode[], path = WT): WorktreeNode => ({ path, name: 'checks', branch: 'feat/checks', kind: 'workspace', agents, pr: null, unread: false })
const repos = (...trees: WorktreeNode[]): RepoNode[] => [{ root: '/code/app', name: 'app', worktrees: [tree([], '/code/app'), ...trees] }]
const terminal = (id: number) => ({ id, view: 'terminal' })
const child = (over: Partial<ChildSession> = {}): ChildSession => ({ id: 'c1', session_id: null, name: 'checks-child', state: 'working', live: true, cwd: WT, ...over }) as ChildSession

const where = (over: Partial<Where> = {}): Where => ({ worktree: WT, repos: repos(tree([])), panes: {}, children: [], ...over })

test('the destination is the worktree’s agent, a new one when nothing runs there, or why not', () => {
  expect(destinationOf(where({ repos: repos(tree([agent({})])), panes: { 7: terminal(7) } }))).toEqual({ kind: 'agent', target: { kind: 'pane', pane: 7, title: 'fix the checks' } })
  expect(destinationOf(where({ children: [child()] }))).toEqual({ kind: 'agent', target: { kind: 'mission', id: 'c1', title: 'checks-child' } })
  expect(destinationOf(where())).toEqual({ kind: 'start' })
  // An agent on a dialog, or running outside the app's terminals, is not replaced by a new one.
  const asking = agent({ state: 'needs-you', waitingFor: 'permission', title: 'asker' })
  expect(destinationOf(where({ repos: repos(tree([asking])), panes: { 7: terminal(7) } }))).toEqual({ kind: 'none', reason: 'asker is waiting on a permission prompt: answer it first' })
  expect(destinationOf(where({ repos: repos(tree([agent({ paneId: null, title: 'elsewhere' })])) }))).toEqual({ kind: 'none', reason: "elsewhere runs outside the app's terminals" })
  expect(destinationOf(where({ worktree: null }))).toEqual({ kind: 'none', reason: 'no worktree is open' })
})

test('only a worktree with no session and no working child counts as empty', () => {
  expect(noAgent(where())).toBe(true)
  expect(noAgent(where({ worktree: '/unknown/tree' }))).toBe(true)
  expect(noAgent(where({ children: [child({ state: 'done' })] }))).toBe(true)
  expect(noAgent(where({ children: [child({ cwd: `${WT}-2` })] }))).toBe(true)
  expect(noAgent(where({ children: [child({ cwd: `${WT}/src` })] }))).toBe(false)
  expect(noAgent(where({ repos: repos(tree([agent({ paneId: null })])) }))).toBe(false)
  expect(noAgent(where({ worktree: null }))).toBe(false)
})

function deps(views: Where[], opts: { alive?: boolean; startFails?: boolean } = {}) {
  const log: string[] = []
  let clock = 0
  let i = 0
  const d: AgentDeps = {
    where: (wt) => {
      log.push(`where ${wt}`)
      return views[Math.min(i++, views.length - 1)]
    },
    sinks: {
      writePty: async (pane, data) => void log.push(`write ${pane} ${JSON.stringify(data)}`),
      reply: async (id, text) => void log.push(`reply ${id} ${text}`),
      paneRunsClaude: async (pane) => (log.push(`check ${pane}`), opts.alive ?? true),
      goToPane: (pane) => void log.push(`go ${pane}`),
      sleep: async () => {},
    },
    start: async (wt) => {
      log.push(`start ${wt}`)
      if (opts.startFails) throw new Error('pty_spawn failed')
    },
    now: () => clock,
    sleep: async (ms) => {
      clock += ms
      log.push(`wait ${ms}`)
    },
  }
  return { d, log }
}

const ready = where({ repos: repos(tree([agent({})])), panes: { 7: terminal(7) } })

test('a running agent gets the prompt as one paste and Enter, once the guard sees Claude', async () => {
  const { d, log } = deps([ready])
  expect(await sendToAgent(WT, 'fix it', d)).toEqual({ title: 'fix the checks', started: false })
  expect(log).toEqual([`where ${WT}`, 'check 7', `write 7 ${JSON.stringify('\x1b[200~fix it\x1b[201~')}`, `write 7 "\\r"`, 'go 7'])
})

test('a dispatched child gets it as a mission reply', async () => {
  const { d, log } = deps([where({ children: [child()] })])
  expect(await sendToAgent(WT, 'fix it', d)).toEqual({ title: 'checks-child', started: false })
  expect(log).toContain('reply c1 fix it')
})

test('nothing is typed when the pane no longer runs Claude, or when the agent is busy asking', async () => {
  const gone = deps([ready], { alive: false })
  await expect(sendToAgent(WT, 'fix it', gone.d)).rejects.toThrow('no longer running in that terminal')
  expect(gone.log.some((l) => l.startsWith('write'))).toBe(false)

  const asking = deps([where({ repos: repos(tree([agent({ state: 'needs-you', waitingFor: 'question', title: 'q' })])), panes: { 7: terminal(7) } })])
  await expect(sendToAgent(WT, 'fix it', asking.d)).rejects.toThrow('q is waiting on a question: answer it first')
  expect(asking.log.some((l) => l.startsWith('start') || l.startsWith('write'))).toBe(false)
})

test('with no agent, one is started in the worktree and gets the prompt once it is up', async () => {
  const empty = where()
  const starting = where({ repos: repos(tree([agent({ paneId: null })])) })
  const { d, log } = deps([empty, empty, starting, ready])
  let told = 0
  expect(await sendToAgent(WT, 'fix it', d, () => told++)).toEqual({ title: 'fix the checks', started: true })
  expect(told).toBe(1)
  expect(log.filter((l) => l.startsWith('start') || l.startsWith('wait') || l.startsWith('write'))).toEqual([
    `start ${WT}`,
    'wait 1000',
    'wait 1000',
    `write 7 ${JSON.stringify('\x1b[200~fix it\x1b[201~')}`,
    'write 7 "\\r"',
  ])
})

test('a started agent that never comes up gets nothing, and says so', async () => {
  const { d, log } = deps([where()])
  await expect(sendToAgent(WT, 'fix it', d)).rejects.toThrow(`Claude did not come up in the new terminal within ${START_TIMEOUT_MS / 1000} s: nothing was sent`)
  expect(log.some((l) => l.startsWith('write'))).toBe(false)
  expect(log.filter((l) => l.startsWith('wait')).length).toBe(START_TIMEOUT_MS / 1000)

  const broken = deps([where()], { startFails: true })
  await expect(sendToAgent(WT, 'fix it', broken.d)).rejects.toThrow('pty_spawn failed')
})
