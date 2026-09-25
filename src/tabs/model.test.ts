import type { Tab } from '../layout/store'
import type { AgentNode, RepoNode } from '../fleet/types'
import { fleetAgents, tabAgent, tabUnread } from './model'

const tab = (id: string, ...panes: number[]): Tab => ({
  id,
  focused: panes[0],
  root:
    panes.length === 1
      ? { kind: 'leaf', pane: panes[0] }
      : { kind: 'split', dir: 'row', ratio: 0.5, children: [{ kind: 'leaf', pane: panes[0] }, { kind: 'leaf', pane: panes[1] }] },
})
const agent = (paneId: number | null, state: AgentNode['state'], since = 100, sessionId = `s${paneId}-${state}`): AgentNode => ({ sessionId, paneId, state, waitingFor: null, title: '', since })

describe('fleetAgents', () => {
  test('every agent of every worktree of every repo', () => {
    const repos: RepoNode[] = [
      { root: '/a', name: 'a', worktrees: [{ path: '/a', name: 'a', branch: 'main', kind: 'main', pr: null, unread: false, agents: [agent(1, 'working')] }] },
      {
        root: '/b',
        name: 'b',
        worktrees: [
          { path: '/b', name: 'b', branch: 'main', kind: 'main', pr: null, unread: false, agents: [] },
          { path: '/b-wt-x', name: 'x', branch: 'x', kind: 'workspace', pr: null, unread: false, agents: [agent(2, 'done'), agent(null, 'idle')] },
        ],
      },
    ]
    expect(fleetAgents(repos).map((a) => a.paneId)).toEqual([1, 2, null])
  })
})

describe('tabAgent', () => {
  test('none when no pane of the tab runs an agent', () => {
    expect(tabAgent(tab('t', 1), [agent(2, 'working'), agent(null, 'working')])).toBeNull()
  })

  test('the loudest of its panes: needs-you over working over done over idle', () => {
    const t = tab('t', 1, 2)
    expect(tabAgent(t, [agent(1, 'idle'), agent(2, 'done')])?.state).toBe('done')
    expect(tabAgent(t, [agent(1, 'done'), agent(2, 'working')])?.state).toBe('working')
    expect(tabAgent(t, [agent(1, 'needs-you'), agent(2, 'working')])?.state).toBe('needs-you')
    expect(tabAgent(t, [agent(2, 'working'), agent(1, 'needs-you')])?.state).toBe('needs-you')
  })

  test('the newest on a tie', () => {
    const t = tab('t', 1, 2)
    expect(tabAgent(t, [agent(1, 'done', 5, 'old'), agent(2, 'done', 9, 'new')])?.sessionId).toBe('new')
    expect(tabAgent(t, [agent(2, 'done', 9, 'new'), agent(1, 'done', 5, 'old')])?.sessionId).toBe('new')
  })
})

describe('tabUnread', () => {
  const t = tab('t', 1, 2)
  test('an agent that finished or asks after the tab was last seen', () => {
    expect(tabUnread(t, [agent(2, 'done', 200)], false, 150)).toBe(true)
    expect(tabUnread(t, [agent(1, 'needs-you', 200)], false, 150)).toBe(true)
  })
  test('not before it was seen, not while working or idle, not in another tab', () => {
    expect(tabUnread(t, [agent(2, 'done', 100)], false, 150)).toBe(false)
    expect(tabUnread(t, [agent(2, 'done', 150)], false, 150)).toBe(false)
    expect(tabUnread(t, [agent(1, 'working', 200), agent(2, 'idle', 200)], false, 150)).toBe(false)
    expect(tabUnread(t, [agent(3, 'done', 200)], false, 150)).toBe(false)
  })
  test('never the tab on screen', () => {
    expect(tabUnread(t, [agent(2, 'done', 200)], true, 150)).toBe(false)
  })
})
