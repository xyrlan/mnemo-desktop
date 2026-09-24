import { activePane, agentSummary, countAgents } from './model'
import type { Fleet } from '../fleet/types'

const agent = (state: 'working' | 'needs-you' | 'done' | 'idle') => ({ sessionId: state, paneId: null, state, waitingFor: null, title: '', since: 0 })
const wt = (...states: Parameters<typeof agent>[0][]) => ({ path: '/w', name: 'w', branch: null, kind: 'main' as const, agents: states.map(agent), pr: null, unread: false })

test('counts agents by state across every repo and worktree', () => {
  const repos: Fleet['repos'] = [
    { root: '/a', name: 'a', worktrees: [wt('working', 'done'), wt('needs-you')] },
    { root: '/b', name: 'b', worktrees: [wt('working')] },
  ]
  expect(countAgents(repos)).toEqual({ 'needs-you': 1, working: 2, done: 1, idle: 0 })
})

test('the summary lists non-zero states, most urgent first', () => {
  expect(agentSummary({ 'needs-you': 1, working: 2, done: 0, idle: 0 }).map((s) => s.label)).toEqual(['1 need you', '2 working'])
  expect(agentSummary({ 'needs-you': 0, working: 0, done: 0, idle: 0 })).toEqual([])
})

test('the active pane is the focused pane of the active tab', () => {
  const pane = { id: 2, view: 'terminal' } as never
  const s = { tabs: [{ id: 't', root: { kind: 'leaf', pane: 2 }, focused: 2 }] as never, activeTab: 't', panes: { 2: pane } }
  expect(activePane(s)).toEqual({ id: 2, pane })
  expect(activePane({ ...s, activeTab: 'x' })).toBeUndefined()
})
