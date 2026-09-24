import { findTarget, pasteOf, sendTo, ENTER_DELAY_MS, type Sources } from './deliver'
import type { AgentNode, RepoNode, WorktreeNode } from '../fleet/types'
import type { ChildSession } from '../mission/types'
import type { Pane } from '../layout/store'

const ROOT = '/code/app'
const WT = '/code/app-wt-feature'
const DISPATCHED = '/code/app-wt-child'
const NESTED = '/code/app/.claude/worktrees/inner'

const agent = (over: Partial<AgentNode>): AgentNode => ({ sessionId: 's', paneId: null, state: 'idle', waitingFor: null, title: '', since: 0, ...over })
const tree = (path: string, kind: WorktreeNode['kind'], agents: AgentNode[] = []): WorktreeNode => ({ path, name: path, branch: null, kind, agents, pr: null, unread: false })
const child = (over: Partial<ChildSession>): ChildSession =>
  ({ id: 'c1', session_id: null, name: 'feat piece', state: 'working', tempo: 'ok', needs: null, detail: '', suggested_reply: null, cwd: DISPATCHED, tokens: 0, live: true, updated_at: null, intent: null, branch: 'feat/x', timeline_len: 0, ...over }) as ChildSession
const term = (id: number, over: Partial<Pane> = {}): Pane => ({ id, view: 'terminal', ...over })

function sources(over: Partial<Sources> = {}, worktrees: WorktreeNode[] = []): Sources {
  const repos: RepoNode[] = [{ root: ROOT, name: 'app', worktrees: [tree(ROOT, 'main'), tree(NESTED, 'workspace'), tree(DISPATCHED, 'dispatched'), ...worktrees] }]
  return { repos, children: [], panes: {}, ...over }
}

test('a dispatched tree’s live child gets the notes through its mission reply', () => {
  const t = findTarget(DISPATCHED, sources({ children: [child({ cwd: `${DISPATCHED}/src`, id: 'abc123', name: 'diff piece' })] }))
  expect(t).toEqual({ kind: 'mission', id: 'abc123', label: 'diff piece' })
})

test('a child that is not live is no target', () => {
  expect(findTarget(DISPATCHED, sources({ children: [child({ live: false })] }))).toBeNull()
})

test('a workspace’s Claude pane is typed to; the focused one wins, else the latest', () => {
  const agents = [agent({ paneId: 5, since: 10, title: 'older' }), agent({ paneId: 6, since: 20, title: 'newer' })]
  const src = sources({ panes: { 5: term(5), 6: term(6) } }, [tree(WT, 'workspace', agents)])
  expect(findTarget(WT, src)).toEqual({ kind: 'pane', pane: 6, label: 'newer' })
  expect(findTarget(WT, { ...src, focused: 5 })).toEqual({ kind: 'pane', pane: 5, label: 'older' })
})

test('an agent whose pane is gone, or is no terminal, is skipped', () => {
  const agents = [agent({ paneId: 7, since: 30 }), agent({ paneId: 8, since: 20, title: 'here' })]
  const src = sources({ panes: { 7: { id: 7, view: 'editor' }, 8: term(8) } }, [tree(WT, 'workspace', agents)])
  expect(findTarget(WT, src)).toMatchObject({ pane: 8 })
})

test('a pane opened for a session in the tree is found before the fleet matched it', () => {
  const src = sources({ panes: { 3: term(3, { cwd: `${WT}/src`, sessionId: 'x', title: 'claude' }), 4: term(4, { cwd: WT }) } }, [tree(WT, 'workspace')])
  expect(findTarget(WT, src)).toEqual({ kind: 'pane', pane: 3, label: 'claude' })
})

test('a pane in a tree nested inside the main checkout belongs to that tree, not the main one', () => {
  const src = sources({ panes: { 9: term(9, { cwd: `${NESTED}/src`, sessionId: 'x' }) } })
  expect(findTarget(ROOT, src)).toBeNull()
  expect(findTarget(NESTED, src)).toMatchObject({ pane: 9 })
})

test('a main checkout does not take a child’s reply, and with nothing running there is no target', () => {
  const src = sources({ children: [child({ cwd: ROOT })] })
  expect(findTarget(ROOT, src)).toBeNull()
})

test('pasteOf wraps the text in a bracketed paste and drops what could end it', () => {
  expect(pasteOf('a\r\nb\x1b[201~c')).toBe('\x1b[200~a\nb[201~c\x1b[201~')
})

test('sendTo types into a pane, then presses Enter; a mission target is replied to', async () => {
  const calls: string[] = []
  const deps = {
    reply: async (id: string, text: string) => void calls.push(`reply ${id} ${text}`),
    write: async (pane: number, data: string) => void calls.push(`write ${pane} ${JSON.stringify(data)}`),
    sleep: async (ms: number) => void calls.push(`sleep ${ms}`),
  }
  await sendTo({ kind: 'pane', pane: 4, label: 'x' }, 'hi\nthere', deps)
  expect(calls).toEqual([`write 4 ${JSON.stringify(pasteOf('hi\nthere'))}`, `sleep ${ENTER_DELAY_MS}`, 'write 4 "\\r"'])
  calls.length = 0
  await sendTo({ kind: 'mission', id: 'c1', label: 'x' }, 'hello', deps)
  expect(calls).toEqual(['reply c1 hello'])
})
