import { act, useEffect, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: async () => null, Channel: class {} }))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))

/** As in view.test.tsx: a record `{type: 'card', card}` is one hand-built card, `{type: 'usage'}`
 *  the context usage. */
vi.mock('./parse', async (orig) => {
  const real = await orig<typeof import('./parse')>()
  return {
    ...real,
    deriveConversation: (records: import('./types').TranscriptRecord[]) => ({
      sessionId: 's1',
      title: null,
      prs: [],
      cards: records.filter((r) => r.type === 'card').map((r) => r.card),
      usage: ([...records].reverse().find((r) => r.type === 'usage')?.usage as import('./types').ContextUsage | undefined) ?? null,
      thinkingAt: null,
    }),
  }
})

/** jsdom lays nothing out: every row is drawn. */
vi.mock('react-virtuoso', async () => {
  const { createElement: h, forwardRef } = await import('react')
  const Virtuoso = forwardRef(function FakeVirtuoso(p: Record<string, any>, _ref) {
    return h('div', { className: 'fake-list' }, ...p.data.map((it: unknown, i: number) => h('div', { key: p.computeItemKey(i, it) }, p.itemContent(i, it))))
  })
  return { Virtuoso }
})

import { ConversationView } from './ConversationView'
import ConversationFace from './Face'
import { ChatInputContext, type ApprovalCardProps, type ChatInputParts, type ComposerProps, type QuestionCardProps } from './chat-input'
import { paneAgent, type ChatAgent, type PaneSinks } from './agent'
import { makeChatPty } from '../chat-input/pty'
import { contextPercent, contextWindow, formatTokens } from './ContextRing'
import { approvalDetail, approvalSummary, askQuestions, proposedHunks, runSentence } from './run'
import type { ConversationClient } from './client'
import type { Card, ContextUsage, FollowEvent, SessionStatus } from './types'
import type { ToolCard } from './stream'
import { store } from '../layout/app-store'
import { leaf } from '../layout/tree'
import { missionStore } from '../mission/app-store'
import { parent } from '../mission/fixtures'
import type { Snapshot } from '../mission/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// ---- builders ---------------------------------------------------------------------------------

const NOT_RUNNING = 'Claude is no longer running in this terminal: nothing was sent'
const T0 = Date.parse('2026-09-24T10:00:00Z')
const at = (s: number) => new Date(T0 + s * 1000).toISOString()
const user = (id: string, s: number, text: string): Card => ({ kind: 'user', id, at: at(s), text, images: [], rules: [], queued: false })
const tool = (id: string, name: string, input: Record<string, unknown>, over: Partial<ToolCard> = {}): ToolCard => ({
  kind: 'tool',
  id,
  at: at(1),
  toolUseId: `tu-${id}`,
  name,
  summary: typeof input.command === 'string' ? input.command : typeof input.file_path === 'string' ? input.file_path : '',
  input,
  outcome: null,
  images: [],
  rules: [],
  ...over,
})
const lines = (cards: Card[], extra: Record<string, unknown>[] = []): FollowEvent => ({
  kind: 'lines',
  start: 0,
  end: 100,
  lines: [...cards.map((card) => JSON.stringify({ type: 'card', card })), ...extra.map((r) => JSON.stringify(r))],
})

/** A client whose one follow is fed by the test. */
function feed() {
  let emit: (e: FollowEvent) => void = () => {}
  const client: ConversationClient = {
    async follow(_s, _c, _t, on) {
      emit = on
      return () => {}
    },
    earlier: async () => ({ start: 0, end: 0, lines: [] }),
    logUsage: async () => {},
  }
  return { client, emit: (e: FollowEvent) => act(async () => emit(e)) }
}

/** chat-input's parts as recorders: what each was last drawn with, and how often the composer
 *  mounted. */
function parts() {
  const seen = { composer: null as ComposerProps | null, approval: null as ApprovalCardProps | null, question: null as QuestionCardProps | null, composerMounts: 0 }
  const p: ChatInputParts = {
    Composer: (props) => {
      seen.composer = props
      useEffect(() => void seen.composerMounts++, [])
      return <div className="fake-composer" data-disabled={props.disabled ? 'yes' : undefined} />
    },
    ApprovalCard: (props) => {
      seen.approval = props
      return <div className="fake-approval" />
    },
    QuestionCard: (props) => {
      seen.question = props
      return <div className="fake-question">{props.question}</div>
    },
  }
  return { p, seen }
}

/** A prompt Claude Code recorded a moment after now: what a send from the chat becomes. */
const recorded = (id: string, text: string): Card => ({ kind: 'user', id, at: new Date(Date.now() + 1000).toISOString(), text, images: [], rules: [], queued: false })

/** An agent that records what it was asked to send, fails when told to, and holds its sends
 *  back while `hold` is on. */
function recorder({ shell = true } = {}) {
  const sent: string[] = []
  let fail: string | null = null
  let held: (() => void)[] | null = null
  const note = (what: string) => async () => {
    if (held) await new Promise<void>((r) => held!.push(r))
    if (fail) throw new Error(fail)
    sent.push(what)
  }
  const agent: ChatAgent = {
    send: async (t) => note(`send ${t}`)(),
    allow: note('allow'),
    deny: note('deny'),
    answer: async (i) => note(`answer ${i}`)(),
    ...(shell ? { bash: async (c: string) => note(`bash ${c}`)() } : {}),
  }
  const release = () => {
    const h = held ?? []
    held = null
    h.forEach((r) => r())
  }
  return { agent, sent, failWith: (m: string | null) => void (fail = m), hold: () => void (held = []), release }
}

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
})

const render = (el: ReactNode) => act(async () => root.render(el))
const q = (sel: string) => host.querySelector<HTMLElement>(sel)
const text = () => host.textContent ?? ''

function chat(client: ConversationClient, p: ChatInputParts, agent: ChatAgent, status?: SessionStatus, onOpenTerminal?: () => void) {
  return (
    <ChatInputContext.Provider value={p}>
      <ConversationView sessionId="s1" cwd="/repo" client={client} agent={agent} status={status} onOpenTerminal={onOpenTerminal} />
    </ChatInputContext.Provider>
  )
}

// ---- the foot ---------------------------------------------------------------------------------

test('idle, the foot is the composer, and what it sends goes to the agent', async () => {
  const { client, emit } = feed()
  const { p, seen } = parts()
  const r = recorder()
  await render(chat(client, p, r.agent, { busy: false, waiting: null }))
  await emit(lines([user('u1', 0, 'hi')]))
  expect(q('.fake-composer')).not.toBeNull()
  expect(seen.composer?.cwd).toBe('/repo')
  await act(() => seen.composer!.onSend('fix it'))
  expect(r.sent).toEqual(['send fix it'])
})

test('a send shows in the stream at once, and gives way to its record: never shown twice', async () => {
  const { client, emit } = feed()
  const { p, seen } = parts()
  const r = recorder()
  await render(chat(client, p, r.agent, { busy: false, waiting: null }))
  await emit(lines([user('u1', 0, 'hi')]))
  r.hold()
  let sent!: Promise<void>
  await act(async () => void (sent = seen.composer!.onSend('fix  the\nbug')))
  // Shown before the keys are even typed.
  expect(q('.cv-outgoing')?.dataset.state).toBe('sending')
  expect(q('.cv-outgoing')?.textContent).toContain('fix  the')
  await act(async () => {
    r.release()
    await sent
  })
  expect(r.sent).toEqual(['send fix  the\nbug'])
  expect(q('.cv-outgoing')?.dataset.state).toBe('sent')
  // Claude Code writes it; the follow reads it back: the record takes its place.
  await emit(lines([recorded('u2', 'fix the bug')]))
  expect(q('.cv-outgoing')).toBeNull()
  expect(host.querySelectorAll('.cv-user')).toHaveLength(2)
})

test('a send that fails is marked in the stream and rejects, so the composer gets its text back; the composer is never remounted', async () => {
  const { client, emit } = feed()
  const { p, seen } = parts()
  const r = recorder()
  await render(chat(client, p, r.agent))
  await emit(lines([user('u1', 0, 'hi')]))
  r.failWith(NOT_RUNNING)
  await act(() => expect(seen.composer!.onSend('lost?')).rejects.toThrow(NOT_RUNNING))
  expect(q('.cv-outgoing')?.dataset.state).toBe('failed')
  expect(q('.cv-not-sent')?.textContent).toBe('Not sent')
  expect(q('.cv-not-sent')?.title).toBe(NOT_RUNNING)
  // The composer says why, beside the text it got back; the foot does not say it again.
  expect(q('.cv-foot-error')).toBeNull()
  expect(seen.composerMounts).toBe(1)
  // Sent again, the failed one goes.
  r.failWith(null)
  await act(() => seen.composer!.onSend('lost?'))
  expect(host.querySelectorAll('.cv-outgoing')).toHaveLength(1)
  expect(q('.cv-outgoing')?.dataset.state).toBe('sent')
})

test('a slash command is sent but not drawn: Claude Code may record nothing for it', async () => {
  const { client, emit } = feed()
  const { p, seen } = parts()
  const r = recorder()
  await render(chat(client, p, r.agent))
  await emit(lines([user('u1', 0, 'hi')]))
  await act(() => seen.composer!.onSend('/config'))
  expect(r.sent).toEqual(['send /config'])
  expect(q('.cv-outgoing')).toBeNull()
})

test("a pane's composer offers the shell; the command runs through the agent, shows at once, then its record with the output", async () => {
  const { client, emit } = feed()
  const { p, seen } = parts()
  const r = recorder()
  await render(chat(client, p, r.agent))
  await emit(lines([user('u1', 0, 'hi')]))
  expect(seen.composer?.onBash).toBeTypeOf('function')
  await act(() => seen.composer!.onBash!('git status'))
  expect(r.sent).toEqual(['bash git status'])
  expect(q('.cv-outgoing')?.textContent).toBe('! git status')
  const ran: Card = { kind: 'command', id: 'b1', at: new Date(Date.now() + 1000).toISOString(), name: '!', args: 'git status', output: { stdout: 'On branch main', stderr: '' } }
  await emit(lines([ran]))
  expect(q('.cv-outgoing')).toBeNull()
  expect(q('.cv-shell .cv-out')?.textContent).toBe('On branch main')
})

test('an agent with no shell (a child answering through its mission) gives the composer no `!`', async () => {
  const { client, emit } = feed()
  const { p, seen } = parts()
  await render(chat(client, p, recorder({ shell: false }).agent))
  await emit(lines([user('u1', 0, 'hi')]))
  expect(seen.composer).not.toBeNull()
  expect(seen.composer?.onBash).toBeUndefined()
})

test('parked on a permission, the approval card says what is asked and answers it; it stays down until the session moves on', async () => {
  const { client, emit } = feed()
  const { p, seen } = parts()
  const r = recorder()
  const waiting: SessionStatus = { busy: false, waiting: 'permission' }
  await render(chat(client, p, r.agent, waiting))
  await emit(lines([user('u1', 0, 'clean up'), tool('t1', 'Bash', { command: 'rm -rf build\nls', description: 'Remove the build dir' })]))
  expect(q('.fake-composer')).toBeNull()
  expect(seen.approval).toMatchObject({ tool: 'Bash', summary: 'rm -rf build', detail: 'Remove the build dir\n\nrm -rf build\nls' })

  await act(() => seen.approval!.onAllow())
  expect(r.sent).toEqual(['allow'])
  // The status still says waiting (it lags a poll): the answered card stays down.
  await render(chat(client, p, r.agent, { ...waiting }))
  expect(q('.fake-approval')).toBeNull()
  expect(q('.fake-composer')).not.toBeNull()

  // Parked on another call after the next prompt: its own card.
  await emit(lines([user('u2', 2, 'now the file'), tool('t2', 'Edit', { file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })]))
  expect(q('.fake-approval')).not.toBeNull()
  expect(seen.approval).toMatchObject({ tool: 'Edit', summary: 'src/a.ts', detail: '-a\n+b' })
  await act(() => seen.approval!.onDeny())
  expect(r.sent).toEqual(['allow', 'deny'])
})

test('with a foot to answer it, the stream only marks the parked call: nothing is said twice', async () => {
  const { client, emit } = feed()
  const { p } = parts()
  await render(chat(client, p, recorder().agent, { busy: false, waiting: 'permission' }, () => {}))
  await emit(lines([user('u1', 0, 'go'), tool('t1', 'Bash', { command: 'make install' })]))
  expect(q('.cv-pending-bar')).toBeNull()
  expect(q('.cv-pending [data-mark="pending"]')?.textContent).toBe('waiting for approval')
  // Not done yet: the run speaks in the present, and does not repeat the command in its head.
  expect(q('.cv-run-sentence')?.textContent).toBe('Running 1 command')
})

test('paths inside the worktree read relative to it, on the line and in the approval', async () => {
  const { client, emit } = feed()
  const { p, seen } = parts()
  await render(chat(client, p, recorder().agent, { busy: false, waiting: 'permission' }))
  await emit(lines([user('u1', 0, 'go'), tool('e1', 'Edit', { file_path: '/repo/src/a.ts', old_string: 'a', new_string: 'b' }), tool('r1', 'Read', { file_path: '/etc/hosts' })]))
  expect(seen.approval?.summary).toBe('src/a.ts')
  const shown = [...host.querySelectorAll('.cv-tool-summary')].map((e) => [e.textContent, e.getAttribute('title')])
  expect(shown).toEqual([
    ['src/a.ts', '/repo/src/a.ts'],
    ['/etc/hosts', '/etc/hosts'],
  ])
})

test('an approval that did not go through keeps the card up, says why, and draws it afresh', async () => {
  const { client, emit } = feed()
  const { p, seen } = parts()
  const r = recorder()
  await render(chat(client, p, r.agent, { busy: false, waiting: 'permission' }))
  await emit(lines([user('u1', 0, 'go'), tool('t1', 'Bash', { command: 'make' })]))
  const first = seen.approval
  r.failWith(NOT_RUNNING)
  await act(() => expect(seen.approval!.onAllow()).rejects.toThrow(NOT_RUNNING))
  expect(q('.fake-approval')).not.toBeNull()
  expect(q('.cv-foot-error')?.textContent).toBe(NOT_RUNNING)
  expect(seen.approval).not.toBe(first)
})

test('a question of several is asked one at a time, each answer typed, then the composer comes back', async () => {
  const { client, emit } = feed()
  const { p, seen } = parts()
  const r = recorder()
  await render(chat(client, p, r.agent, { busy: false, waiting: 'question' }))
  const questions = [
    { question: 'Which port?', header: 'Port', options: [{ label: '3000', description: 'dev' }, { label: '8080' }] },
    { question: 'Keep the cache?', options: [{ label: 'Yes' }, { label: 'No' }] },
  ]
  await emit(lines([user('u1', 0, 'set it up'), tool('q1', 'AskUserQuestion', { questions })]))
  expect(seen.question).toMatchObject({ question: 'Which port?', options: ['3000', '8080'] })
  // This pane types keys; an answer in words is not one it can give.
  expect(seen.question?.onOther).toBeUndefined()
  await act(() => seen.question!.onAnswer(1))
  expect(seen.question).toMatchObject({ question: 'Keep the cache?', options: ['Yes', 'No'] })
  await act(() => seen.question!.onAnswer(0))
  expect(r.sent).toEqual(['answer 1', 'answer 0'])
  expect(q('.fake-question')).toBeNull()
  expect(q('.fake-composer')).not.toBeNull()
})

test('an agent that takes words gets the question card\'s other answer', async () => {
  const { client, emit } = feed()
  const { p, seen } = parts()
  const r = recorder()
  const words: string[] = []
  const agent = { ...r.agent, other: async (t: string) => void words.push(t) }
  await render(chat(client, p, agent, { busy: false, waiting: 'question' }))
  await emit(lines([user('u1', 0, 'ask'), tool('q1', 'AskUserQuestion', { questions: [{ question: 'Name?', options: [{ label: 'a' }] }] })]))
  await act(() => seen.question!.onOther!('zed'))
  expect(words).toEqual(['zed'])
  expect(q('.fake-question')).toBeNull()
})

test('waiting on something no card can answer, the foot sends you to the terminal instead of typing blind', async () => {
  const { client, emit } = feed()
  const { p } = parts()
  const r = recorder()
  const onOpenTerminal = vi.fn()
  // Waiting on a permission the transcript has not written the call for yet.
  await render(chat(client, p, r.agent, { busy: false, waiting: 'permission' }, onOpenTerminal))
  await emit(lines([user('u1', 0, 'go')]))
  expect(q('.fake-composer')).toBeNull()
  expect(q('.cv-foot-waiting')?.textContent).toContain('The transcript does not say on what yet')
  // A dialog (`/config`).
  await render(chat(client, p, r.agent, { busy: false, waiting: null, parked: true }, onOpenTerminal))
  expect(q('.fake-composer')).toBeNull()
  expect(q('.cv-foot-waiting')?.textContent).toContain('showing a dialog')
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>('.cv-foot-waiting button')][0].click())
  expect(onOpenTerminal).toHaveBeenCalledTimes(1)
})

test('without chat-input landed, a pending card still says what it waits for in the foot', async () => {
  const { client, emit } = feed()
  const r = recorder()
  await render(chat(client, {}, r.agent, { busy: false, waiting: 'permission' }))
  await emit(lines([user('u1', 0, 'go'), tool('t1', 'Bash', { command: 'make' })]))
  expect(q('.cv-foot-waiting')?.textContent).toContain('Waiting for approval')
})

test('no agent, no foot: the mission pane keeps its own footer', async () => {
  const { client, emit } = feed()
  const { p } = parts()
  await render(
    <ChatInputContext.Provider value={p}>
      <ConversationView sessionId="s1" cwd="/repo" client={client} footer={<div className="reply">reply</div>} />
    </ChatInputContext.Provider>,
  )
  await emit(lines([user('u1', 0, 'hi')]))
  expect(q('.cv-foot')).toBeNull()
  expect(q('.cv-footer .reply')).not.toBeNull()
})

// ---- the pane's agent -------------------------------------------------------------------------

function sinks() {
  const writes: string[] = []
  const s: PaneSinks = {
    sendPrompt: async (pane, text) => void writes.push(`prompt ${pane} ${text}`),
    sendBash: async (pane, command) => void writes.push(`bash ${pane} ${command}`),
    answerApproval: async (pane, allow) => void writes.push(`approval ${pane} ${allow}`),
    answerQuestion: async (pane, i) => void writes.push(`question ${pane} ${i}`),
  }
  return { s, writes }
}

test('the pane agent writes each answer through its pane', async () => {
  const { s, writes } = sinks()
  const a = paneAgent(7, s)
  await a.send('hello')
  await a.bash!('ls')
  await a.allow()
  await a.deny()
  await a.answer(2)
  expect(writes).toEqual(['prompt 7 hello', 'bash 7 ls', 'approval 7 true', 'approval 7 false', 'question 7 2'])
  expect(a.other).toBeUndefined()
})

/** The pane agent over chat-input's real keystrokes, with the pane's check counted. */
function typed(runs: boolean | 'throws') {
  let asked = 0
  const keys: string[] = []
  const pty = makeChatPty({
    writePty: async (_pane, data) => void keys.push(data),
    paneRunsClaude: async () => {
      asked++
      if (runs === 'throws') throw new Error('no pid')
      return runs
    },
    sleep: async () => {},
  })
  const s: PaneSinks = { sendPrompt: pty.sendPrompt, sendBash: pty.sendBash, answerApproval: pty.answerApproval, answerQuestion: pty.answerQuestion }
  return { a: paneAgent(7, s), keys, asked: () => asked }
}

test('whether the pane still runs Claude is asked once per write, right before it types', async () => {
  const { a, asked } = typed(true)
  await a.send('hello')
  expect(asked()).toBe(1)
  await a.bash!('ls')
  await a.allow()
  await a.answer(0)
  expect(asked()).toBe(4)
})

test.each([
  ['Claude has exited', false],
  ['the check itself failed', 'throws'],
] as const)('nothing is typed when %s', async (_, runs) => {
  const { a, keys } = typed(runs)
  for (const write of [() => a.send('rm -rf /'), () => a.bash!('rm -rf /'), () => a.allow(), () => a.deny(), () => a.answer(0)]) await expect(write()).rejects.toThrow()
  expect(keys).toEqual([])
})

const PANE = 5
const snapWith = (status: string, waiting_for?: string | null): Snapshot => ({
  repos: [{ root: '/repo', name: 'repo', parents: [parent({ session_id: 's1', status, cwd: '/repo', waiting_for })], missions: [], children: [] }],
  errors: [],
  at: '',
})

test('the face answers through its pane, and its terminal button flips back to the terminal', async () => {
  store.setState({
    tabs: [{ id: 't', root: leaf(PANE), focused: PANE }],
    activeTab: 't',
    panes: { [PANE]: { id: PANE, view: 'terminal', cwd: '/repo', sessionId: 's1', face: 'conversation' } },
  })
  missionStore.setState({ snapshot: snapWith('waiting', 'permission prompt') })
  const { tauriConversation } = await import('./client')
  vi.spyOn(tauriConversation, 'follow').mockImplementation(async (_s, _c, _t, on) => {
    on(lines([user('u1', 0, 'go'), tool('t1', 'Bash', { command: 'make' })]))
    return () => {}
  })
  const { p, seen } = parts()
  const { s, writes } = sinks()
  await render(
    <ChatInputContext.Provider value={p}>
      <ConversationFace paneId={PANE} sinks={s} />
    </ChatInputContext.Provider>,
  )
  expect(q('.conversation-face')?.hasAttribute('data-ui')).toBe(true)
  await act(() => seen.approval!.onAllow())
  expect(writes).toEqual([`approval ${PANE} true`])

  await act(async () => q('.cv-to-terminal')!.click())
  expect(store.getState().panes[PANE].face).toBe('terminal')
})

// ---- the context ring -------------------------------------------------------------------------

const usage = (tokens: number, model: string | null = 'claude-opus-5'): ContextUsage => ({ tokens, model, at: at(0) })

test('the ring reads the last response against a 200k window, or 1M once it holds more', () => {
  expect(contextWindow(usage(150_000))).toBe(200_000)
  expect(contextPercent(usage(150_000))).toBe(75)
  expect(contextWindow(usage(250_000))).toBe(1_000_000)
  expect(contextPercent(usage(250_000))).toBe(25)
  expect(contextWindow(usage(1_000, 'claude-opus-5[1m]'))).toBe(1_000_000)
  expect(contextPercent(usage(400_000, null))).toBe(40)
  expect([formatTokens(981), formatTokens(18_600), formatTokens(981_400), formatTokens(999_960), formatTokens(1_000_000)]).toEqual(['981', '18.6k', '981.4k', '1M', '1M'])
})

test('the head carries the context ring once a response said how full it is, red past 90%', async () => {
  const { client, emit } = feed()
  const { p } = parts()
  await render(chat(client, p, recorder().agent))
  await emit(lines([user('u1', 0, 'hi')]))
  expect(q('.cv-ring')).toBeNull()
  await emit(lines([user('u1', 0, 'hi')], [{ type: 'usage', usage: usage(46_000) }]))
  expect(q('.cv-ring')?.getAttribute('aria-label')).toBe('Context 46k of 200k tokens, 23% used')
  expect(q('.cv-ring')?.className).not.toContain('text-destructive')
  await emit(lines([user('u1', 0, 'hi')], [{ type: 'usage', usage: usage(190_000) }]))
  expect(q('.cv-ring')?.className).toContain('text-destructive')
})

// ---- the run's words --------------------------------------------------------------------------

test('a run reads as one sentence: a clause per kind of work, in the order it did them', () => {
  const t = (name: string, input: Record<string, unknown> = {}) => tool(name, name, input)
  expect(runSentence([t('Read'), t('Read'), t('Glob')], false)).toBe('Read 2 files and searched 1 time')
  expect(runSentence([t('Edit'), t('Bash', { command: 'pnpm test' }), t('mcp__mnemo__read_mnemo_rule'), t('Skill')], false)).toBe('Edited 1 file, ran 1 command, used 1 integration, and used 1 tool')
  expect(runSentence([t('Bash', { command: 'git push' })], false)).toBe('git push')
  expect(runSentence([t('Bash', { command: 'git push' })], true)).toBe('Running 1 command')
  expect(runSentence([t('TodoWrite'), t('TodoWrite')], true)).toBe('Updating the plan 2 times')
  expect(runSentence([t('WebFetch')], false)).toBe('Read the web 1 time')
})

test('an approval names the command or the file, with the rest as its detail', () => {
  expect(approvalSummary(tool('b', 'Bash', { command: 'git push --force\n' }))).toBe('git push --force')
  expect(approvalDetail(tool('b', 'Bash', { command: 'git push' }))).toBeUndefined()
  expect(approvalDetail(tool('b', 'Bash', { command: 'git push', description: 'Push the branch' }))).toBe('Push the branch')
  expect(approvalSummary(tool('w', 'Write', { file_path: '/p/new.ts', content: 'x\ny\n' }))).toBe('/p/new.ts')
  expect(approvalDetail(tool('w', 'Write', { file_path: '/p/new.ts', content: 'x\ny\n' }))).toBe('+x\n+y')
  expect(approvalDetail(tool('f', 'WebFetch', { url: 'https://example.invalid' }))).toBe('{\n  "url": "https://example.invalid"\n}')
  expect(approvalDetail(tool('n', 'Skill', {}))).toBeUndefined()
})

test('the change an edit asks for, before it is made', () => {
  expect(proposedHunks('Edit', { old_string: 'a\nb', new_string: 'c' })).toEqual([{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 1, lines: ['-a', '-b', '+c'] }])
  expect(proposedHunks('MultiEdit', { edits: [{ old_string: 'a', new_string: 'b' }, { nope: 1 }, { old_string: '', new_string: 'x' }] })).toEqual([
    { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] },
    { oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, lines: ['+x'] },
  ])
  expect(proposedHunks('Write', { content: 'one\n' })).toEqual([{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, lines: ['+one'] }])
  expect(proposedHunks('Edit', { old_string: 'a' })).toBeNull()
  expect(proposedHunks('Bash', { command: 'ls' })).toBeNull()
})

test('the questions of an AskUserQuestion, each with its option labels', () => {
  expect(askQuestions({ questions: [{ question: 'A?', options: [{ label: 'x' }, 'y', { nope: 1 }] }, { nope: true }, { question: 'B?' }] })).toEqual([
    { question: 'A?', options: ['x', 'y'] },
    { question: 'B?', options: [] },
  ])
  expect(askQuestions({})).toEqual([])
})

test('the chat head says nothing of a terminal to a view with no agent', async () => {
  const { client, emit } = feed()
  await render(<ConversationView sessionId="s1" cwd="/repo" client={client} onOpenTerminal={() => {}} />)
  await emit(lines([user('u1', 0, 'hi')]))
  expect(q('.cv-to-terminal')).toBeNull()
  expect(text()).toContain('hi')
})
