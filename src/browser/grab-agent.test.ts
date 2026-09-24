import { expect, test } from 'vitest'
import type { AgentNode, RepoNode, WorktreeNode } from '../fleet/types'
import type { ChildSession } from '../mission/types'
import { deliver, KEY_GAP_MS, pasteOf, resolveAgent, type Where } from './grab-agent'

const WT = '/code/app-wt-feature'

const agent = (over: Partial<AgentNode>): AgentNode => ({ sessionId: 's1', paneId: 7, state: 'working', waitingFor: null, title: 'fix the header', since: 0, ...over })
const tree = (agents: AgentNode[], path = WT): WorktreeNode => ({ path, name: 'feature', branch: 'feature', kind: 'workspace', agents, pr: null, unread: false })
const repos = (...trees: WorktreeNode[]): RepoNode[] => [{ root: '/code/app', name: 'app', worktrees: [tree([], '/code/app'), ...trees] }]
const terminal = (id: number, over: object = {}) => ({ id, view: 'terminal', ...over })
const child = (over: Partial<ChildSession>): ChildSession =>
  ({ id: 'c1', session_id: null, name: 'design-mode', state: 'working', live: true, cwd: `${WT}/src`, ...over }) as ChildSession

const where = (over: Partial<Where>): Where => ({ worktree: WT, repos: repos(), panes: {}, children: [], ...over })

test('an agent in one of the worktree’s terminals is typed into', () => {
  const w = where({ repos: repos(tree([agent({})])), panes: { 7: terminal(7) } })
  expect(resolveAgent(w)).toEqual({ kind: 'pane', pane: 7, title: 'fix the header' })
  // A trailing slash on the shown worktree is the same worktree.
  expect(resolveAgent({ ...w, worktree: `${WT}/` }).kind).toBe('pane')
})

test('a pane that is gone, exited, broken or not a terminal does not count', () => {
  const r = repos(tree([agent({})]))
  expect(resolveAgent(where({ repos: r, panes: {} })).kind).toBe('none')
  expect(resolveAgent(where({ repos: r, panes: { 7: terminal(7, { exitCode: 0 }) } })).kind).toBe('none')
  expect(resolveAgent(where({ repos: r, panes: { 7: terminal(7, { error: 'x' }) } })).kind).toBe('none')
  expect(resolveAgent(where({ repos: r, panes: { 7: { id: 7, view: 'browser' } } })).kind).toBe('none')
})

test('an agent on a dialog is passed over: keys typed now would answer it', () => {
  const asking = agent({ paneId: 7, state: 'needs-you', waitingFor: 'permission', title: 'asker' })
  const panes = { 7: terminal(7), 8: terminal(8) }
  expect(resolveAgent(where({ repos: repos(tree([asking, agent({ sessionId: 's2', paneId: 8, title: 'free' })])), panes }))).toEqual({
    kind: 'pane',
    pane: 8,
    title: 'free',
  })
  expect(resolveAgent(where({ repos: repos(tree([asking])), panes }))).toEqual({ kind: 'none', reason: 'asker is waiting on a permission prompt: answer it first' })
  const question = agent({ state: 'needs-you', waitingFor: 'question', title: 'q' })
  expect(resolveAgent(where({ repos: repos(tree([question])), panes }))).toEqual({ kind: 'none', reason: 'q is waiting on a question: answer it first' })
})

test('a dispatched child working in the worktree gets a mission reply', () => {
  expect(resolveAgent(where({ children: [child({})] }))).toEqual({ kind: 'mission', id: 'c1', title: 'design-mode' })
  expect(resolveAgent(where({ children: [child({ name: null })] }))).toEqual({ kind: 'mission', id: 'c1', title: 'c1' })
  // Finished, stopped, not running, or in a sibling tree whose name starts the same: no.
  for (const c of [child({ state: 'done' }), child({ state: 'stopped' }), child({ live: false }), child({ cwd: `${WT}-2` })]) {
    expect(resolveAgent(where({ children: [c] })).kind).toBe('none')
  }
})

test('with nobody to send to, it says why', () => {
  expect(resolveAgent(where({ worktree: null }))).toEqual({ kind: 'none', reason: 'no worktree is open' })
  expect(resolveAgent(where({ repos: repos(tree([])) }))).toEqual({ kind: 'none', reason: 'no agent is running in feature' })
  expect(resolveAgent(where({ repos: repos(tree([agent({ paneId: null, title: 'elsewhere' })])) }))).toEqual({
    kind: 'none',
    reason: "elsewhere runs outside the app's terminals",
  })
  expect(resolveAgent(where({ worktree: '/unknown/tree' }))).toEqual({ kind: 'none', reason: 'no agent is running in tree' })
})

test('a paste cannot end itself early or press keys', () => {
  expect(pasteOf('a\r\nb\x1b[201~\x03c\td')).toBe('\x1b[200~a\nb[201~c\td\x1b[201~')
})

function sinks() {
  const log: string[] = []
  return {
    log,
    s: {
      writePty: async (pane: number, data: string) => void log.push(`write ${pane} ${JSON.stringify(data)}`),
      reply: async (id: string, text: string) => void log.push(`reply ${id} ${text}`),
      goToPane: (pane: number) => void log.push(`go ${pane}`),
      sleep: async (ms: number) => void log.push(`sleep ${ms}`),
    },
  }
}

test('in a pane: the screenshot as a dropped file, then the text as one paste, then Enter', async () => {
  const { log, s } = sinks()
  await deliver({ kind: 'pane', pane: 3, title: 't' }, 'hi\nthere', '/tmp/my shot.png', s)
  expect(log).toEqual([
    `write 3 ${JSON.stringify('/tmp/my\\ shot.png ')}`,
    `sleep ${KEY_GAP_MS}`,
    `write 3 ${JSON.stringify('\x1b[200~hi\nthere\x1b[201~')}`,
    `sleep ${KEY_GAP_MS}`,
    'write 3 "\\r"',
    'go 3',
  ])
})

test('without a screenshot only the text goes; a child gets a reply; nobody is an error', async () => {
  const { log, s } = sinks()
  await deliver({ kind: 'pane', pane: 3, title: 't' }, 'hi', null, s)
  expect(log[0]).toBe(`write 3 ${JSON.stringify('\x1b[200~hi\x1b[201~')}`)
  log.length = 0
  await deliver({ kind: 'mission', id: 'c1', title: 't' }, 'hi', '/tmp/x.png', s)
  expect(log).toEqual(['reply c1 hi'])
  await expect(deliver({ kind: 'none', reason: 'no agent' }, 'hi', null, s)).rejects.toThrow('no agent')
})
