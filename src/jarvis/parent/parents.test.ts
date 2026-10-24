import type { Agent } from '../../agent/active'
import type { FollowEvent } from '../../conversation/types'
import type { SessionSpec } from '../../nexus/drawer/open'
import { lines, T0, transcript } from './fixtures'
import { handoff } from './handoff'
import type { Host, ParentEvent } from './index'
import { makeParents, PROMPT_UP_MS, SETTLE_MS, type ParentDeps } from './parents'
import type { Row } from './follow'

const GROK: Agent = { kind: 'grok', config_dir: '/Users/you/.grok-work' }
const CLAUDE: Agent = { kind: 'claude', config_dir: null }

/** The app as `ParentDeps` sees it: a session opens in pane 1, 2, …; its prompt is up once `up`
 *  holds it; every key typed is recorded. */
function app(over: { config?: Host | null; accounts?: Partial<Record<Host, Agent>>; neverUp?: boolean } = {}) {
  let clock = T0
  let ids = 0
  const opened: Extract<SessionSpec, { kind: 'claude' }>[] = []
  const panes = new Map<string, number>()
  const alive = new Set<number>()
  const up = new Set<number>()
  const typed: [number, string][] = []
  const answered: [number, boolean][] = []
  const ended: number[] = []
  const follows = new Map<string, (e: FollowEvent) => void>()
  const stopped: string[] = []
  const rowsCb: (() => void)[] = []
  const panesCb: (() => void)[] = []
  const state = { rows: [] as (Row & { session_id: string; parent_session?: string })[], at: null as number | null }
  const deps: ParentDeps = {
    async openSession(spec) {
      opened.push(spec)
      const pane = opened.length
      panes.set(spec.sessionId!, pane)
      alive.add(pane)
      if (!over.neverUp) up.add(pane)
    },
    paneOf: (id) => (panes.has(id) && alive.has(panes.get(id)!) ? panes.get(id)! : null),
    async endSession(pane) {
      ended.push(pane)
      alive.delete(pane)
    },
    runsAgent: async (pane) => alive.has(pane) && up.has(pane),
    sendPrompt: async (pane, text) => void typed.push([pane, text]),
    answerApproval: async (pane, allow) => void answered.push([pane, allow]),
    agentFor: (host) => (over.accounts ?? { claude: CLAUDE })[host] ?? null,
    defaultHost: async () => over.config ?? null,
    rows: () => state,
    onRows: (cb) => (rowsCb.push(cb), () => {}),
    paneAlive: (pane) => alive.has(pane),
    onPanes: (cb) => (panesCb.push(cb), () => {}),
    async follow(sessionId, _cwd, onEvent) {
      follows.set(sessionId, onEvent)
      return () => void stopped.push(sessionId)
    },
    newId: () => `parent-${++ids}`,
    now: () => clock,
    sleep: async (ms) => void (clock += ms),
  }
  const parents = makeParents(async () => deps)
  const events: ParentEvent[] = []
  parents.subscribe((e) => events.push(e))
  return {
    parents,
    events,
    opened,
    typed,
    answered,
    ended,
    stopped,
    up,
    /** The mission poll brought `rows`, read at `at`. */
    poll(rows: typeof state.rows, at: number | null = null) {
      state.rows = rows
      state.at = at
      rowsCb.forEach((cb) => cb())
    },
    /** The tailer sent these lines of `sessionId`'s transcript. */
    write: (sessionId: string, ls: string[]) => follows.get(sessionId)!({ kind: 'lines', start: 0, end: 0, lines: ls }),
    exitPane(pane: number) {
      alive.delete(pane)
      panesCb.forEach((cb) => cb())
    },
    clock: () => clock,
  }
}

const settle = () => new Promise((r) => setTimeout(r, 0))
const OPEN = { project: 'mnemo-desktop', root: '/work/mnemo-desktop', request: 'corrige o teste', task: '', conversation: '', gathered: 'git status: clean' }

test('a parent opens as New session does, never skipping its prompts, and gets the handoff once its prompt is up', async () => {
  const a = app()
  const before = a.clock()
  const ref = await a.parents.open(OPEN)
  expect(a.opened).toEqual([{ kind: 'claude', root: '/work/mnemo-desktop', sessionId: 'parent-1', agent: CLAUDE, ask: true }])
  expect(a.typed).toEqual([[1, handoff({ task: '', words: 'corrige o teste', conversation: '', gathered: 'git status: clean' })]])
  // Typed only after the TUI was given time to draw.
  expect(a.clock() - before).toBeGreaterThanOrEqual(SETTLE_MS)
  expect(ref).toEqual({ sessionId: 'parent-1', project: 'mnemo-desktop', root: '/work/mnemo-desktop', request: 'corrige o teste', host: 'claude', startedAt: before })
  expect(a.events).toEqual([{ kind: 'opened', parent: ref }])
  expect(a.parents.running()).toEqual([ref])
  expect(await a.parents.status('parent-1')).toEqual({ state: 'working', summary: null, question: null })
})

test("a parent given the brain's task is handed it with the words and the conversation, and is known by it", async () => {
  const a = app()
  const o = { ...OPEN, request: 'sim, manda', task: 'Fix the flaky upload test and open a PR.', conversation: 'Maintainer: o teste de upload falha\nJarvis: Quer que eu mande para um parent?' }
  const ref = await a.parents.open(o)
  expect(a.typed).toEqual([[1, handoff({ task: o.task, words: 'sim, manda', conversation: o.conversation, gathered: 'git status: clean' })]])
  expect(ref.request).toBe('Fix the flaky upload test and open a PR.')
})

test('the host is the request’s, else the config’s, else Claude; one with no account refuses, and nothing opens', async () => {
  const a = app({ config: 'grok', accounts: { claude: CLAUDE, grok: GROK } })
  expect((await a.parents.open(OPEN)).host).toBe('grok')
  expect((await a.parents.open({ ...OPEN, host: 'claude' })).host).toBe('claude')
  expect(a.opened.map((s) => s.agent)).toEqual([GROK, CLAUDE])
  expect((await app().parents.open(OPEN)).host).toBe('claude')
  const none = app({ config: 'grok' })
  await expect(none.parents.open(OPEN)).rejects.toThrow('There is no Grok Build account to open a parent on')
  expect(none.opened).toEqual([])
  // Newest first.
  expect(a.parents.running().map((p) => p.sessionId)).toEqual(['parent-2', 'parent-1'])
})

test('a parent whose prompt never comes up gets nothing typed, and the open says so', async () => {
  const a = app({ neverUp: true })
  await expect(a.parents.open(OPEN)).rejects.toThrow(`claude did not come up in mnemo-desktop within ${PROMPT_UP_MS / 1000} s`)
  expect(a.typed).toEqual([])
  expect(a.parents.running()).toEqual([])
  expect(a.events).toEqual([])
})

test('following: a waiting approval said and answered from the desktop, the end of the turn, a follow-up typed; never a child', async () => {
  const a = app()
  const ref = await a.parents.open(OPEN)
  const t = transcript()
  await expect(a.parents.answer('parent-1', true)).rejects.toThrow('waiting on no permission prompt')

  a.write('parent-1', lines([t.prompt('p1', 'the handoff'), t.tool('a1', 'tu1', 'Bash', { command: 'pnpm test' })]))
  // A child the parent dispatched has a row of its own, waiting too: it is not the parent's.
  a.poll([
    { session_id: 'parent-1', status: 'waiting', waiting_for: 'permission prompt' },
    { session_id: 'child-9', status: 'waiting', waiting_for: 'permission prompt', parent_session: 'parent-1' },
  ])
  expect(a.events.slice(1)).toEqual([{ kind: 'approval', parent: ref, question: 'Bash: pnpm test' }])
  expect(await a.parents.status('parent-1')).toEqual({ state: 'approval', summary: null, question: 'Bash: pnpm test' })

  await a.parents.answer('parent-1', true)
  expect(a.answered).toEqual([[1, true]])
  expect((await a.parents.status('parent-1')).state).toBe('working')

  a.write('parent-1', lines([t.result('r1', 'tu1', 'ok'), t.said('a2', 'The tests pass now. Nothing else changed.'), t.end('e1')]))
  expect(a.events.slice(2)).toEqual([{ kind: 'turn-ended', parent: ref, summary: 'The tests pass now.' }])

  await a.parents.send('parent-1', 'abre um PR também')
  expect(a.typed.at(-1)).toEqual([1, 'abre um PR também'])
  expect((await a.parents.status('parent-1')).state).toBe('working')
  expect(a.events).toHaveLength(3)
})

test('cancel ends the parent’s terminal and says it exited; a parent whose terminal closes, or whose agent exits to the shell, exits too', async () => {
  const a = app()
  const one = await a.parents.open(OPEN)
  const two = await a.parents.open({ ...OPEN, request: 'outra coisa' })
  const three = await a.parents.open({ ...OPEN, request: 'mais uma' })

  await a.parents.cancel('parent-1')
  expect(a.ended).toEqual([1])
  expect(a.stopped).toContain('parent-1')

  a.exitPane(2)

  // Listed, then not any more, with its terminal at the shell's prompt.
  a.poll([{ session_id: 'parent-3', status: 'idle' }])
  a.up.delete(3)
  a.poll([])
  await settle()

  expect(a.events.filter((e) => e.kind === 'exited')).toEqual([
    { kind: 'exited', parent: one },
    { kind: 'exited', parent: two },
    { kind: 'exited', parent: three },
  ])
  expect(a.parents.running()).toEqual([])
  await expect(a.parents.send('parent-2', 'x')).rejects.toThrow('has exited')
  await expect(a.parents.status('nobody')).rejects.toThrow('Jarvis opened no parent nobody')
})
