import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { onTestFinished, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: async () => null, Channel: class {} }))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))

/** The parser piece writes `deriveConversation`; until it lands (and so these tests stay about
 *  the view) a record `{type: 'card', card}` is one hand-built card, `{type: 'title'}` the title. */
vi.mock('./parse', async (orig) => {
  const real = await orig<typeof import('./parse')>()
  return {
    ...real,
    deriveConversation: (records: import('./types').TranscriptRecord[]) => ({
      sessionId: (records.find((r) => typeof r.sessionId === 'string')?.sessionId as string | undefined) ?? null,
      title: ([...records].reverse().find((r) => r.type === 'title')?.title as string | undefined) ?? null,
      prs: records.filter((r) => r.type === 'pr').map((r) => r.pr),
      cards: records.filter((r) => r.type === 'card').map((r) => r.card),
      usage: ([...records].reverse().find((r) => r.type === 'usage')?.usage as import('./types').ContextUsage | undefined) ?? null,
      thinkingAt: ([...records].reverse().find((r) => r.type === 'thinking')?.at as string | undefined) ?? null,
    }),
  }
})

/** jsdom lays nothing out, and react-virtuoso draws no row without sizes. This stand-in draws
 *  every row with the props the view gave it, and hands those props to the tests, so they can
 *  play the list's part: reach the top, leave the bottom. */
const virt = vi.hoisted(() => ({ props: null as Record<string, any> | null, scrolls: [] as unknown[] }))
vi.mock('react-virtuoso', async () => {
  const { createElement: h, forwardRef, useImperativeHandle } = await import('react')
  const Virtuoso = forwardRef(function FakeVirtuoso(p: Record<string, any>, ref) {
    virt.props = p
    useImperativeHandle(ref, () => ({ scrollToIndex: (x: unknown) => virt.scrolls.push(x) }))
    const { Header, Footer } = p.components ?? {}
    return h(
      'div',
      { className: 'fake-list', 'data-first': p.firstItemIndex, 'data-initial': p.initialTopMostItemIndex },
      Header && h(Header, { context: p.context }),
      ...p.data.map((it: unknown, i: number) => h('div', { key: p.computeItemKey(i + p.firstItemIndex, it), 'data-index': i }, p.itemContent(i + p.firstItemIndex, it))),
      Footer && h(Footer, { context: p.context }),
    )
  })
  return { Virtuoso }
})

import { ConversationView } from './ConversationView'
import ConversationFace, { paneStatus, waitingKind } from './Face'
import { ChatInputContext } from './chat-input'
import { RuleActionsContext, type RuleActions } from './cards/context'
import { diffRows } from './cards/diff'
import { tauriConversation, type ConversationClient } from './client'
import { applyEarlier, applyEvent, clockText, firstIndex, newSegment, pendingCard, streamItems, TAIL, workingSince, STATUS_LAG_MS, type Item } from './stream'
import { startUsage, BEAT_MS, type UsageDeps } from './usage'
import type { Card, Chunk, Conversation, FollowEvent, SessionStatus, StatusMarker, ToolOutcome } from './types'
import PaneBar from '../chrome/PaneBar'
import { store } from '../layout/app-store'
import { createStore } from '../layout/store'
import { leaf } from '../layout/tree'
import { missionStore } from '../mission/app-store'
import { parent } from '../mission/fixtures'
import type { Snapshot } from '../mission/types'
import agentsWaiting from '../../src-tauri/fixtures/agents-waiting.json'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// ---- builders ---------------------------------------------------------------------------------

const T0 = Date.parse('2026-09-23T10:00:00Z')
const at = (s: number) => new Date(T0 + s * 1000).toISOString()

const user = (id: string, s: number, text: string, over: Partial<Extract<Card, { kind: 'user' }>> = {}): Card => ({ kind: 'user', id, at: at(s), text, images: [], rules: [], queued: false, ...over })
const said = (id: string, s: number, text: string): Card => ({ kind: 'assistant', id, at: at(s), text })
const tool = (id: string, s: number, name: string, outcome: ToolOutcome | null, over: Partial<Extract<Card, { kind: 'tool' }>> = {}): Card => ({
  kind: 'tool',
  id,
  at: at(s),
  toolUseId: `tu-${id}`,
  name,
  summary: `${name} summary`,
  input: {},
  outcome,
  images: [],
  rules: [],
  ...over,
})

const conv = (sessionId: string, cards: Card[]): Conversation => ({ sessionId, title: null, prs: [], cards, usage: null, thinkingAt: null })
const line = (card: Card, sessionId = 's1') => JSON.stringify({ type: 'card', uuid: card.id, sessionId, card })
const lines = (start: number, cards: Card[], sessionId = 's1'): FollowEvent => ({ kind: 'lines', start, end: start + 100 * cards.length, lines: cards.map((c) => line(c, sessionId)) })

type Follow = { sessionId: string; cwd: string; tail: number; stopped: boolean; emit(e: FollowEvent): Promise<void> }

function fakeClient() {
  const follows: Follow[] = []
  const chunks: Chunk[] = []
  const earlier = vi.fn(async (_s: string, _c: string, _b: number, _n: number): Promise<Chunk> => chunks.shift() ?? { start: 0, end: 0, lines: [] })
  const logUsage = vi.fn(async () => {})
  const client: ConversationClient = {
    async follow(sessionId, cwd, tail, onEvent) {
      const f: Follow = { sessionId, cwd, tail, stopped: false, emit: (e) => act(async () => onEvent(e)) }
      follows.push(f)
      return () => void (f.stopped = true)
    },
    earlier,
    logUsage,
  }
  return { client, follows, chunks, earlier }
}

function fakeRules(result: { code: number | null; stderr?: string } = { code: 0 }) {
  const opened: string[] = []
  const vetoed: string[] = []
  const rules: RuleActions = {
    open: (slug) => void opened.push(slug),
    veto: async (slug) => (vetoed.push(slug), { stdout: '', stderr: result.stderr ?? '', code: result.code }),
  }
  return { rules, opened, vetoed }
}

// ---- mounting ---------------------------------------------------------------------------------

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  virt.props = null
  virt.scrolls = []
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
const text = () => host.textContent ?? ''
const q = <E extends Element = HTMLElement>(sel: string) => host.querySelector<E & HTMLElement>(sel)
const qa = (sel: string) => [...host.querySelectorAll<HTMLElement>(sel)]
const click = (el: Element | null) => act(async () => (el as HTMLElement).click())
/** A row's words, without the time it shows on hover. */
const words = (el: Element) => {
  const c = el.cloneNode(true) as Element
  c.querySelectorAll('time').forEach((t) => t.remove())
  return c.textContent ?? ''
}
const rowTexts = () => qa('.fake-list > [data-index]').map(words)
const button = (label: string | RegExp) => qa('button').find((b) => (typeof label === 'string' ? b.textContent === label : label.test(b.textContent ?? ''))) ?? null

type ViewProps = Partial<Parameters<typeof ConversationView>[0]>
function view(client: ConversationClient, props: ViewProps = {}, rules: RuleActions = fakeRules().rules) {
  return (
    <RuleActionsContext.Provider value={rules}>
      <ConversationView sessionId="s1" cwd="/repo" client={client} {...props} />
    </RuleActionsContext.Provider>
  )
}

// ---- following --------------------------------------------------------------------------------

test('follows the last 200 lines of the session under its cwd, draws every card, and unfollows on unmount', async () => {
  const { client, follows } = fakeClient()
  await render(view(client))
  expect(follows).toHaveLength(1)
  expect(follows[0]).toMatchObject({ sessionId: 's1', cwd: '/repo', tail: TAIL })
  expect(TAIL).toBe(200)
  expect(text()).toContain('Loading the conversation…')

  await follows[0].emit(lines(500, [user('u1', 0, 'fix the **bug**'), said('a1', 1, 'on it')]))
  expect(qa('.cv-user')).toHaveLength(1)
  expect(q('.cv-user strong')?.textContent).toBe('bug')
  expect(q('.cv-assistant .cv-md')?.textContent).toBe('on it')
  expect(virt.props!.initialTopMostItemIndex).toBe(1)

  await follows[0].emit(lines(700, [said('a2', 2, 'done')]))
  expect(qa('.cv-assistant .cv-md').map((e) => e.textContent)).toEqual(['on it', 'done'])

  act(() => root.unmount())
  expect(follows[0].stopped).toBe(true)
  root = createRoot(host)
})

test('a cd in the pane does not restart the follow', async () => {
  const { client, follows } = fakeClient()
  await render(view(client))
  await render(view(client, { cwd: '/elsewhere' }))
  expect(follows).toHaveLength(1)
})

test('a transcript not written yet says so until its first lines', async () => {
  const { client, follows } = fakeClient()
  await render(view(client))
  await follows[0].emit({ kind: 'missing' })
  expect(text()).toContain('waiting for the transcript…')
  await follows[0].emit(lines(0, [user('u1', 0, 'hello')]))
  expect(text()).not.toContain('waiting for the transcript')
  expect(q('.cv-bubble')?.textContent).toBe('hello')
})

test('a reset drops everything shown and draws what follows from the top', async () => {
  const { client, follows } = fakeClient()
  await render(view(client))
  await follows[0].emit(lines(900, [user('u1', 0, 'old one'), said('a1', 1, 'old answer')]))
  await follows[0].emit({ kind: 'reset' })
  await follows[0].emit(lines(0, [user('u9', 5, 'new one')]))
  expect(text()).not.toContain('old')
  expect(q('.cv-bubble')?.textContent).toBe('new one')
})

test('a new session id (a /clear) keeps the old cards above a divider and follows the new one below', async () => {
  const { client, follows } = fakeClient()
  await render(view(client))
  await follows[0].emit(lines(0, [user('u1', 0, 'before clear')]))
  await render(view(client, { sessionId: 's2' }))
  expect(follows[0].stopped).toBe(true)
  expect(follows[1]).toMatchObject({ sessionId: 's2', tail: TAIL })
  await follows[1].emit(lines(0, [user('u1', 10, 'after clear')], 's2'))

  expect(rowTexts()).toEqual(['before clear', '/clear', 'after clear'])
  // The same card id in both files is two rows, not one.
  expect(new Set(virt.props!.data.map((it: Item) => it.key)).size).toBe(3)
})

test('the session going away keeps what was shown', async () => {
  const { client, follows } = fakeClient()
  await render(view(client))
  await follows[0].emit(lines(0, [user('u1', 0, 'still here')]))
  await render(view(client, { sessionId: null }))
  expect(text()).toContain('still here')
  expect(follows).toHaveLength(1)
})

test('with no session at all it says so', async () => {
  const { client, follows } = fakeClient()
  await render(view(client, { sessionId: null }))
  expect(follows).toHaveLength(0)
  expect(text()).toContain('No Claude session yet')
})

test('reaching the top reads the lines before the first one, puts them above without moving the rows on screen, and stops at the top of the file', async () => {
  const { client, follows, chunks, earlier } = fakeClient()
  await render(view(client))
  await follows[0].emit(lines(4000, [user('u3', 30, 'third')]))
  expect(text()).toContain('Scroll up for earlier')
  const first = virt.props!.firstItemIndex as number

  chunks.push({ start: 1200, end: 4000, lines: [line(user('u2', 20, 'second')), line(said('a2', 21, 'second answer'))] })
  await act(async () => virt.props!.startReached())
  expect(earlier).toHaveBeenCalledWith('s1', '/repo', 4000, TAIL)
  expect(rowTexts()).toEqual(['second', 'second answer', 'third'])
  expect(virt.props!.firstItemIndex).toBe(first - 2)

  chunks.push({ start: 0, end: 1200, lines: [line(user('u1', 10, 'first'))] })
  await act(async () => virt.props!.startReached())
  expect(earlier).toHaveBeenLastCalledWith('s1', '/repo', 1200, TAIL)
  expect(virt.props!.firstItemIndex).toBe(first - 3)
  expect(text()).toContain('Start of the session')

  await act(async () => virt.props!.startReached())
  expect(earlier).toHaveBeenCalledTimes(2)
})

test('two scroll events at the top read earlier lines once', async () => {
  const { client, follows, chunks, earlier } = fakeClient()
  await render(view(client))
  await follows[0].emit(lines(4000, [user('u3', 30, 'third')]))
  chunks.push({ start: 0, end: 4000, lines: [] })
  await act(async () => {
    virt.props!.startReached()
    virt.props!.startReached()
  })
  expect(earlier).toHaveBeenCalledTimes(1)
})

test('a failed earlier read says so, and retry reads again', async () => {
  const { client, follows, earlier } = fakeClient()
  await render(view(client))
  await follows[0].emit(lines(4000, [user('u3', 30, 'third')]))
  earlier.mockRejectedValueOnce('gone')
  await act(async () => virt.props!.startReached())
  expect(text()).toContain('Could not load earlier lines: gone')
  await click(button('Retry'))
  expect(earlier).toHaveBeenCalledTimes(2)
})

// ---- the bottom -------------------------------------------------------------------------------

test('lines arriving while you read above show a jump-to-latest pill that scrolls down, and none while you are at the bottom', async () => {
  const { client, follows } = fakeClient()
  await render(view(client))
  await follows[0].emit(lines(0, [user('u1', 0, 'one')]))
  expect(virt.props!.followOutput(true)).toBe('auto')
  expect(virt.props!.followOutput(false)).toBe(false)

  await follows[0].emit(lines(100, [said('a1', 1, 'two')]))
  expect(button('Jump to latest')).toBeNull()

  await act(async () => virt.props!.atBottomStateChange(false))
  expect(button('Jump to latest')).toBeNull()
  await follows[0].emit(lines(200, [said('a2', 2, 'three')]))
  expect(button('Jump to latest')).not.toBeNull()
  await click(button('Jump to latest'))
  expect(virt.scrolls).toEqual([{ index: 'LAST', behavior: 'smooth' }])

  await act(async () => virt.props!.atBottomStateChange(true))
  expect(button('Jump to latest')).toBeNull()
})

// ---- status -----------------------------------------------------------------------------------

test('busy shows a working row counting from the prompt', async () => {
  const { client, follows } = fakeClient()
  const since = Date.now() - 42_000
  await render(view(client, { status: { busy: true, waiting: null } }))
  await follows[0].emit({ kind: 'lines', start: 0, end: 10, lines: [JSON.stringify({ type: 'card', card: { ...user('u1', 0, 'go'), at: new Date(since).toISOString() } })] })
  expect(q('.cv-working')?.textContent).toMatch(/^Working…0:4[23]$/)
  await render(view(client, { status: { busy: false, waiting: null } }))
  expect(q('.cv-working')).toBeNull()
})

test('while waiting, the first unresolved tool call since the last prompt becomes the pending card, with open terminal', async () => {
  const { client, follows } = fakeClient()
  const onOpenTerminal = vi.fn()
  const waiting: SessionStatus = { busy: false, waiting: 'permission' }
  await render(view(client, { status: waiting, onOpenTerminal }))
  await follows[0].emit(
    lines(0, [
      tool('old', 0, 'Bash', null),
      user('u1', 1, 'go on'),
      tool('t1', 2, 'Read', { kind: 'text', text: 'x' }),
      tool('t2', 3, 'Bash', null, { input: { command: 'rm -rf build' } }),
      tool('t3', 3, 'Grep', null),
    ]),
  )
  const pending = qa('.cv-pending')
  expect(pending).toHaveLength(1)
  // The run it is in opens by itself, and the call opens to what it asks to run.
  expect(pending[0].textContent).toContain('$ rm -rf build')
  expect(pending[0].textContent).toContain('waiting for approval')
  expect(q('.cv-pending-bar')?.textContent).toContain('Waiting for approval')
  expect(q('.cv-pending-bar')?.textContent).toContain('rm -rf build')
  await click(button('Open terminal'))
  expect(onOpenTerminal).toHaveBeenCalledTimes(1)

  await render(view(client, { status: { busy: true, waiting: null }, onOpenTerminal }))
  expect(qa('.cv-pending')).toHaveLength(0)
})

test('an AskUserQuestion waits for your answer; with no terminal to open there is no button', async () => {
  const { client, follows } = fakeClient()
  await render(view(client, { status: { busy: false, waiting: 'permission' } }))
  await follows[0].emit(lines(0, [user('u1', 0, 'ask me'), tool('q1', 1, 'AskUserQuestion', null)]))
  expect(q('.cv-pending-bar')?.textContent).toContain('Waiting for your answer')
  expect(button('Open terminal')).toBeNull()
})

test('markers are merged into the stream by time, and the footer is pinned under it', async () => {
  const { client, follows } = fakeClient()
  const markers: StatusMarker[] = [
    { at: at(30), label: 'done' },
    { at: at(5), label: 'blocked · needs approval' },
  ]
  await render(view(client, { markers, footer: <div className="reply">reply box</div> }))
  await follows[0].emit(lines(0, [user('u1', 0, 'start'), said('a1', 10, 'middle'), said('a2', 20, 'end')]))
  expect(rowTexts()).toEqual(['start', 'blocked · needs approval', 'middle', 'end', 'done'])
  expect(q('.cv-footer .reply')?.textContent).toBe('reply box')
  expect(q('.cv-stream .reply')).toBeNull()
})

test('a footer given as a function is handed the call the session is parked on, or null', async () => {
  const { client, follows } = fakeClient()
  const seen: (string | null)[] = []
  const footer = (parked: { tool: { id: string }; kind: string } | null) => {
    seen.push(parked && `${parked.tool.id}:${parked.kind}`)
    return parked ? <div className="reply">{parked.kind}</div> : null
  }
  await render(view(client, { status: { busy: false, waiting: 'permission' }, footer }))
  await follows[0].emit(lines(0, [user('u1', 0, 'go'), tool('t1', 1, 'Bash', null)]))
  expect(seen.at(-1)).toBe('t1:permission')
  expect(q('.cv-footer .reply')?.textContent).toBe('permission')
  await render(view(client, { status: { busy: true, waiting: null }, footer }))
  expect(seen.at(-1)).toBeNull()
  // Nothing to say: no empty footer strip.
  expect(q('.cv-footer')).toBeNull()
})

// A window that starts partway into the file has records not loaded above it, and the markers
// of their time with them: those would all stack atop the first card. Only the newest is kept,
// as the state the window opens in; the rest come back in place with their records.
test('markers older than a partial window keep only the newest, until earlier records load', async () => {
  const { client, follows, chunks } = fakeClient()
  const markers: StatusMarker[] = [
    { at: at(1), label: 'working' },
    { at: at(3), label: 'blocked · awaiting approval' },
    { at: at(6), label: 'working' },
    { at: at(15), label: 'blocked · needs input' },
    { at: at(30), label: 'done' },
  ]
  await render(view(client, { markers }))
  await follows[0].emit(lines(4000, [user('u5', 10, 'in window'), said('a5', 20, 'answer')]))
  const rows = rowTexts
  expect(rows()).toEqual(['working(since earlier)', 'in window', 'blocked · needs input', 'answer', 'done'])
  expect(qa('.cv-marker .cv-carried')).toHaveLength(1)

  // Loading the older records puts their markers back beside them, and the rows that were on
  // screen keep their indexes though the carried marker above them is gone.
  const first = virt.props!.firstItemIndex as number
  chunks.push({ start: 0, end: 4000, lines: [line(user('u1', 0, 'first')), line(said('a1', 2, 'early answer')), line(said('a2', 5, 'later'))] })
  await act(async () => virt.props!.startReached())
  expect(rows()).toEqual(['first', 'working', 'early answer', 'blocked · awaiting approval', 'later', 'working', 'in window', 'blocked · needs input', 'answer', 'done'])
  expect(qa('.cv-marker .cv-carried')).toHaveLength(0)
  const index = (key: string) => (virt.props!.data as Item[]).findIndex((it) => it.key === key) + virt.props!.firstItemIndex
  expect(index('0:u5')).toBe(first + 1)
})

test('a window at the start of its file keeps every marker before its first card', () => {
  const seg = { ...applyEvent(newSegment(0, 's1'), lines(0, [said('a1', 10, 'x')])) }
  const c1 = conv('s1', [said('a1', 10, 'x')])
  const markers = [{ at: at(1), label: 'starting' }, { at: at(2), label: 'working' }]
  const shown = (s: typeof seg) => streamItems([s], [c1], markers, undefined).map((i) => (i.kind === 'marker' ? `${i.marker.label}${i.carried ? '*' : ''}` : i.kind))
  expect(shown(seg)).toEqual(['starting', 'working', 'card'])
  expect(shown({ ...seg, start: 900 })).toEqual(['working*', 'card'])
})

test('after a /clear, markers before a partial later window collapse too, not those of the segment above', () => {
  const a = applyEvent(newSegment(0, 's1'), lines(0, [said('a1', 0, 'old session')]))
  const b = applyEvent(newSegment(1, 's2'), lines(700, [said('b1', 20, 'new session')], 's2'))
  const convs = [
    conv('s1', [said('a1', 0, 'old session')]),
    conv('s2', [said('b1', 20, 'new session')]),
  ]
  const markers = [{ at: at(5), label: 'done' }, { at: at(12), label: 'working' }, { at: at(15), label: 'blocked' }]
  const shown = streamItems([a, b], convs, markers, undefined).map((i) => (i.kind === 'marker' ? `${i.marker.label}${i.carried ? '*' : ''}` : i.kind))
  expect(shown).toEqual(['card', 'clear', 'earlier', 'blocked*', 'card'])
})

test('the title and PR links of the transcript head the view', async () => {
  const { client, follows } = fakeClient()
  await render(view(client))
  await follows[0].emit({
    kind: 'lines',
    start: 0,
    end: 10,
    lines: [JSON.stringify({ type: 'title', title: 'Fix the tailer' }), JSON.stringify({ type: 'pr', pr: { number: 162, url: 'https://github.com/x/y/pull/162' } })],
  })
  expect(q('.cv-title')?.textContent).toBe('Fix the tailer')
  expect(q('.cv-pr')?.textContent).toBe('#162')
})

// ---- rule chips -------------------------------------------------------------------------------

test('a rule chip opens its rule; its veto arms on the first click and disables it on the second', async () => {
  const { client, follows } = fakeClient()
  const r = fakeRules()
  await render(view(client, {}, r.rules))
  await follows[0].emit(lines(0, [user('u1', 0, 'hi', { rules: [{ slug: 'no-force-push', channel: 'reflex' }] }), tool('t1', 1, 'Edit', null, { rules: [{ slug: 'edit-small', channel: 'enrichment' }] })]))
  expect(q('.cv-user .cv-rule-reflex')?.textContent).toContain('no-force-push')
  expect(q('.cv-run .cv-rule-enrichment')?.textContent).toContain('edit-small')

  await click(q('.cv-user .cv-rule-open'))
  expect(r.opened).toEqual(['no-force-push'])

  const veto = () => q('.cv-user .cv-rule-veto')
  await click(veto())
  expect(r.vetoed).toEqual([])
  expect(veto()?.textContent).toBe('really?')
  await click(veto())
  expect(r.vetoed).toEqual(['no-force-push'])
  expect(q('.cv-user .cv-rule')?.className).toContain('cv-rule-off')
  expect(q('.cv-user .cv-rule-state')?.textContent).toBe('disabled')
})

test('a veto that mnemo refuses says it failed and can be tried again', async () => {
  const { client, follows } = fakeClient()
  const r = fakeRules({ code: 1, stderr: 'no such rule' })
  await render(view(client, {}, r.rules))
  await follows[0].emit(lines(0, [user('u1', 0, 'hi', { rules: [{ slug: 'ghost', channel: 'reflex' }] })]))
  await click(q('.cv-rule-veto'))
  await click(q('.cv-rule-veto'))
  expect(q('.cv-rule-veto')?.textContent).toBe('× failed')
  expect(q('.cv-rule-veto')?.title).toContain('no such rule')
})

test('the session block folds its briefing and carries the briefing and learned chips', async () => {
  const { client, follows } = fakeClient()
  await render(view(client))
  const session: Card = {
    kind: 'session',
    id: 'ss',
    at: at(0),
    source: 'clear',
    briefing: '## TL;DR\n\nBuilt the **setup** pane.',
    rules: [
      { slug: 'b-rule', channel: 'briefing' },
      { slug: 'l-rule', channel: 'learned' },
    ],
  }
  await follows[0].emit(lines(0, [session]))
  expect(q('.cv-session-head')?.textContent).toContain('Session clear')
  expect(q('.cv-briefing')).toBeNull()
  await click(button(/Briefing/))
  expect(q('.cv-briefing strong')?.textContent).toBe('setup')
  expect(q('.cv-rule-learned')?.textContent).toContain('l-rule')
  expect(q('.cv-rule-briefing')?.textContent).toContain('b-rule')
})

// ---- cards ------------------------------------------------------------------------------------

const hunk = (n: number) => ({ oldStart: 10, oldLines: n, newStart: 10, newLines: n, lines: Array.from({ length: n }, (_, i) => (i % 2 ? `+new ${i}` : `-old ${i}`)) })
const runHead = (i = 0) => qa('.cv-run')[i].querySelector<HTMLButtonElement>('button[aria-expanded]')!
const sentence = (i = 0) => qa('.cv-run-sentence')[i]?.textContent

test('calls one after another fold to one sentence, and open to a line per call', async () => {
  const { client, follows } = fakeClient()
  await render(view(client))
  await follows[0].emit(
    lines(0, [
      user('u1', 0, 'look around'),
      tool('r1', 1, 'Read', { kind: 'text', text: 'body' }, { summary: 'src/a.ts' }),
      tool('g1', 2, 'Grep', { kind: 'text', text: 'hits' }),
      tool('b1', 3, 'Bash', { kind: 'bash', stdout: 'ok', stderr: '', interrupted: false }, { input: { command: 'ls' } }),
      said('a1', 4, 'found it'),
      tool('r2', 5, 'Read', { kind: 'text', text: 'more' }, { summary: 'src/b.ts' }),
    ]),
  )
  expect(qa('.cv-run')).toHaveLength(2)
  expect(sentence(0)).toBe('Read 1 file, searched 1 time, and ran 1 command')
  expect(qa('.cv-run')[0].querySelector('[aria-label="done"]')).not.toBeNull()
  expect(qa('.cv-run')[0].querySelectorAll('.cv-tool')).toHaveLength(0)
  // A lone call that is not a command keeps what it touched beside its sentence.
  expect(sentence(1)).toBe('Read 1 file')
  expect(qa('.cv-run')[1].textContent).toContain('src/b.ts')

  await click(runHead(0))
  expect(runHead(0).getAttribute('aria-expanded')).toBe('true')
  expect([...qa('.cv-run')[0].querySelectorAll('.cv-tool')].map((l) => l.getAttribute('data-tool'))).toEqual(['Read', 'Grep', 'Bash'])
  await click(runHead(0))
  expect(qa('.cv-run')[0].querySelectorAll('.cv-tool')).toHaveLength(0)
})

test('a lone command, settled, is its own header', async () => {
  const { client, follows } = fakeClient()
  await render(view(client))
  await follows[0].emit(lines(0, [tool('b1', 0, 'Bash', { kind: 'bash', stdout: '', stderr: '', interrupted: false }, { input: { command: 'git push\necho done' } })]))
  expect(sentence()).toBe('git push')
})

test('the live run speaks in the present, with its latest call beside it; the working line leaves the call to it', async () => {
  const { client, follows } = fakeClient()
  await render(view(client, { status: { busy: true, waiting: null } }))
  await follows[0].emit(
    lines(0, [
      user('u1', 0, 'test it'),
      tool('r1', 1, 'Read', { kind: 'text', text: '' }, { summary: 'package.json' }),
      tool('b1', 2, 'Bash', null, { summary: 'pnpm test', input: { command: 'pnpm test' } }),
    ]),
  )
  expect(q('.cv-run')?.getAttribute('data-run-state')).toBe('live')
  expect(sentence()).toBe('Reading 1 file and running 1 command')
  expect(q('.cv-run')?.textContent).toContain('Running pnpm test')
  expect(q('.cv-working')?.textContent).toMatch(/^Working…/)

  // Said something after it: the run is settled though the session still works.
  await follows[0].emit(lines(100, [said('a1', 3, 'waiting on the tests')]))
  expect(q('.cv-run')?.getAttribute('data-run-state')).toBe('settled')
  expect(sentence()).toBe('Read 1 file and ran 1 command')
  expect(q('.cv-working')?.textContent).toMatch(/^Working…/)
})

test('thinking is the working line while it is the last thing the session did', async () => {
  const { client, follows } = fakeClient()
  await render(view(client, { status: { busy: true, waiting: null } }))
  await follows[0].emit({ kind: 'lines', start: 0, end: 10, lines: [line(user('u1', 0, 'think')), JSON.stringify({ type: 'thinking', at: at(1) })] })
  expect(q('.cv-working')?.textContent).toContain('Thinking…')
})

test('failed calls are counted on the header, and the line says how each ended', async () => {
  const { client, follows } = fakeClient()
  await render(view(client))
  await follows[0].emit(
    lines(0, [
      tool('r1', 0, 'Read', { kind: 'text', text: 'file body' }, { summary: 'src/a.ts', input: { file_path: 'src/a.ts' } }),
      tool('d1', 1, 'Write', { kind: 'denied', reason: 'user-rejected', feedback: 'not that file' }),
      tool('m1', 2, 'mcp__mnemo__read_mnemo_rule', { kind: 'error', text: 'boom' }),
    ]),
  )
  expect(q('.cv-run')?.textContent).toContain('2 failed')
  expect(q('.cv-run [aria-label="done"]')).toBeNull()
  await click(runHead())
  const [read, denied, mcp] = qa('.cv-tool')
  expect(read.textContent).toContain('src/a.ts')
  expect(read.textContent).not.toContain('file body')
  // A denial is short and matters: it shows with the line folded.
  expect(denied.textContent).toContain('Denied · user-rejected')
  expect(denied.querySelector('blockquote')?.textContent).toBe('not that file')
  expect(mcp.querySelector('code')?.textContent).toBe('mnemo · read_mnemo_rule')
  expect(mcp.querySelector('[data-mark]')?.textContent).toBe('failed')

  await click(read.querySelector('button'))
  expect(qa('.cv-tool')[0].textContent).toContain('file body')
  expect(qa('.cv-tool')[0].querySelector('.cv-input')?.textContent).toContain('"file_path": "src/a.ts"')
})

test('an edit opens to its diff card: verb, file, counts, and the rows, which fold', async () => {
  const written: string[] = []
  stubClipboard(async (t) => void written.push(t))
  const { client, follows } = fakeClient()
  await render(view(client))
  await follows[0].emit(lines(0, [tool('e1', 0, 'Edit', { kind: 'diff', filePath: 'src/a.ts', created: false, hunks: [hunk(30)] }), tool('w1', 1, 'Write', { kind: 'diff', filePath: 'src/b.ts', created: true, hunks: [hunk(4)] })]))
  expect(sentence()).toBe('Edited 2 files')
  expect(q('.cv-diff')).toBeNull()
  await click(runHead())
  const [edit, write] = qa('.cv-diff')
  expect(edit.getAttribute('data-verb')).toBe('edited')
  expect(edit.textContent).toContain('Edited file')
  expect(edit.textContent).toContain('a.ts')
  expect(edit.querySelector('[aria-label="15 added, 15 removed"]')?.textContent).toBe('+15 -15')
  expect(edit.querySelectorAll('.cv-diff-row')).toHaveLength(30)
  expect(write.textContent).toContain('Added file')
  expect(write.querySelectorAll('.cv-diff-add, .cv-diff-del')).toHaveLength(4)

  await click(edit.querySelector('button[aria-expanded]'))
  expect(qa('.cv-diff')[0].querySelectorAll('.cv-diff-row')).toHaveLength(0)
  await click(qa('.cv-diff')[1].querySelector('button[aria-label="Copy diff"]'))
  expect(written).toEqual([hunk(4).lines.join('\n')])
})

test('diff rows are numbered from each hunk start on both sides', () => {
  const rows = diffRows([{ oldStart: 5, oldLines: 3, newStart: 7, newLines: 3, lines: [' same', '-gone', '+came', ' same', '\\ No newline at end of file'] }])
  expect(rows.map((r) => (r.kind === 'hunk' ? r.text : [r.kind, r.old, r.new, r.text]))).toEqual([
    '@@ -5,3 +7,3 @@',
    ['ctx', 5, 7, 'same'],
    ['del', 6, null, 'gone'],
    ['add', null, 8, 'came'],
    ['ctx', 7, 9, 'same'],
    ['note', null, null, '\\ No newline at end of file'],
  ])
})

/** A commit made through a heredoc, as Claude Code writes one. Written for this test, not
 *  taken from a transcript, so there is nothing to scrub. */
const HEREDOC = [
  `git commit -m "$(cat <<'EOF'`,
  'fix(parser): a quoted path keeps its spaces',
  '',
  'The tokenizer split on every space, so `cd "My Drive"` moved to "My.',
  'Quotes now group a token; an unclosed quote runs to the end of the line.',
  '',
  'Co-Authored-By: A. Contributor <contributor@example.invalid>',
  'EOF',
  ')"',
].join('\n')

/** jsdom has no `navigator.clipboard`. */
function stubClipboard(writeText: (t: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  onTestFinished(() => void delete (navigator as { clipboard?: unknown }).clipboard)
}

test('a command opens to the whole of itself and its output, and copies whole', async () => {
  const written: string[] = []
  stubClipboard(async (t) => void written.push(t))
  const { client, follows } = fakeClient()
  await render(view(client))
  await follows[0].emit(lines(0, [tool('h1', 0, 'Bash', { kind: 'bash', stdout: '[main 1a2b3c4] fix\n', stderr: 'warn', interrupted: false }, { summary: 'git commit …', input: { command: HEREDOC } })]))
  // The header is its first line; the rest is one click in.
  expect(sentence()).toBe(HEREDOC.split('\n')[0])
  await click(runHead())
  expect(q('.cv-cmd')).toBeNull()
  await click(q('.cv-tool button'))
  expect(q('.cv-cmd')?.textContent).toBe(`$ ${HEREDOC}`)
  expect(qa('.cv-out').map((e) => e.textContent)).toEqual(['[main 1a2b3c4] fix\n', 'warn'])
  expect(q('.cv-out.cv-err')?.textContent).toBe('warn')

  await click(q('button[aria-label="Copy command"]'))
  expect(written).toEqual([HEREDOC])
  expect(q('button[aria-label="Copied"]')).not.toBeNull()
})

test('a failed copy says so', async () => {
  stubClipboard(async () => Promise.reject(new Error('denied')))
  const { client, follows } = fakeClient()
  await render(view(client))
  await follows[0].emit(lines(0, [said('a1', 0, 'copy me')]))
  await click(q('button[aria-label="Copy message"]'))
  expect(q('button[aria-label="Copy failed"]')).not.toBeNull()
})

test('an edit waiting on approval opens to the change it asks to make', async () => {
  const { client, follows } = fakeClient()
  await render(view(client, { status: { busy: false, waiting: 'permission' } }))
  await follows[0].emit(lines(0, [user('u1', 0, 'go'), tool('e1', 1, 'Edit', null, { summary: 'src/a.ts', input: { file_path: 'src/a.ts', old_string: 'one\ntwo', new_string: 'three' } })]))
  const diff = q('.cv-pending .cv-diff')
  expect(diff?.getAttribute('data-verb')).toBe('proposed')
  expect(diff?.textContent).toContain('Wants to edit')
  expect([...diff!.querySelectorAll('.cv-diff-row')].map((r) => r.textContent)).toEqual(['-one', '-two', '+three'])
})

test('what is unfolded stays unfolded as new lines arrive', async () => {
  const { client, follows } = fakeClient()
  await render(view(client))
  await follows[0].emit(lines(0, [tool('r1', 0, 'Read', { kind: 'text', text: 'file body' })]))
  await click(runHead())
  await click(q('.cv-tool button'))
  await follows[0].emit(lines(100, [said('a1', 1, 'more')]))
  expect(text()).toContain('file body')
})

test('the rules that reached a folded run stay in sight under it', async () => {
  const { client, follows } = fakeClient()
  await render(view(client))
  await follows[0].emit(
    lines(0, [
      tool('e1', 0, 'Edit', null, { rules: [{ slug: 'edit-small', channel: 'enrichment' }] }),
      tool('e2', 1, 'Edit', null, { rules: [{ slug: 'edit-small', channel: 'enrichment' }, { slug: 'no-any', channel: 'enrichment' }] }),
    ]),
  )
  expect(qa('.cv-run .cv-rule').map((r) => r.querySelector('.cv-rule-open')?.textContent)).toEqual(['⟡ edit-small', '⟡ no-any'])
})

test('agent, peer, notification, compaction, command, queued, thinking and unknown cards', async () => {
  const { client, follows } = fakeClient()
  await render(view(client))
  await follows[0].emit(
    lines(0, [
      { kind: 'agent', id: 'g1', at: at(0), toolUseId: 'tu', description: 'find the tailer', agentType: 'Explore', report: 'It is in **conversation.rs**.' },
      { kind: 'agent', id: 'g2', at: at(1), toolUseId: 'tu2', description: 'still going', agentType: null, report: null },
      { kind: 'peer', id: 'p1', at: at(2), from: 'round20-parser', text: 'fixtures are in' },
      { kind: 'notification', id: 'n1', at: at(3), text: 'task 4 finished' },
      { kind: 'notification', id: 'n2', at: at(3), text: 'conversation compacted' },
      { kind: 'command', id: 'c1', at: at(4), name: 'model', args: 'opus' },
      user('q1', 5, 'next thing', { queued: true }),
      { kind: 'thinking', id: 'th', at: at(6), text: 'The tailer\nreads\nlines\nfrom\nthe end.' },
      { kind: 'unknown', id: 'x1', at: at(7), type: 'atis-latch-v2' },
    ]),
  )
  const agent = qa('.cv-agent')[0]
  expect(agent.textContent).toContain('Agent · Explore')
  expect(agent.textContent).toContain('find the tailer')
  expect(agent.querySelector('.cv-md')).toBeNull()
  await click(agent.querySelector('button'))
  expect(qa('.cv-agent')[0].querySelector('strong')?.textContent).toBe('conversation.rs')
  expect(qa('.cv-agent')[1].querySelector('[aria-label="running"]')).not.toBeNull()
  expect(q('.cv-peer-from')?.textContent).toBe('From round20-parser')
  expect(qa('.cv-notification').map((n) => n.textContent)).toEqual(['task 4 finished', 'Context compacted'])
  expect(q('.cv-command')?.textContent).toBe('/model opus')
  expect(q('.cv-queued .cv-badge')?.textContent).toBe('Queued')
  const thinking = q('.cv-thinking')!
  expect(thinking.textContent).toBe('The tailer\nreads\nlines\nfrom\nthe end.')
  expect(thinking.getAttribute('aria-expanded')).toBe('false')
  await click(thinking)
  expect(q('.cv-thinking')?.getAttribute('aria-expanded')).toBe('true')
  expect(q('.cv-unknown')?.textContent).toBe('unknown atis-latch-v2')
})

test('a question is asked in words, and its answers show once given', async () => {
  const { client, follows } = fakeClient()
  await render(view(client))
  const questions = [{ question: 'Which port?', options: [{ label: '3000' }, { label: '8080' }] }]
  await follows[0].emit(lines(0, [tool('q1', 0, 'AskUserQuestion', { kind: 'answers', answers: { 'Which port?': '8080' } }, { input: { questions } })]))
  expect(q('.cv-ask')?.textContent).toContain('Asked')
  expect(q('.cv-ask')?.textContent).toContain('Which port?')
  expect(q('.cv-ask dd')?.textContent).toBe('8080')
})

test('a plan is a card to read', async () => {
  const { client, follows } = fakeClient()
  await render(view(client))
  await follows[0].emit(lines(0, [tool('p1', 0, 'ExitPlanMode', { kind: 'text', text: 'ok' }, { input: { plan: '1. Read **it**\n2. Fix it' } })]))
  expect(q('.cv-plan strong')?.textContent).toBe('it')
  expect(q('.cv-plan')?.textContent).toContain('Approved')
})

test('an image is decoded only once it is near the screen, and a click enlarges it until Esc', async () => {
  const observers: { cb: IntersectionObserverCallback; seen: Element[] }[] = []
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      o: { cb: IntersectionObserverCallback; seen: Element[] }
      constructor(cb: IntersectionObserverCallback) {
        observers.push((this.o = { cb, seen: [] }))
      }
      observe(el: Element) {
        this.o.seen.push(el)
      }
      disconnect() {}
    },
  )
  try {
    const { client, follows } = fakeClient()
    await render(view(client))
    await follows[0].emit(lines(0, [user('u1', 0, 'look', { images: [{ mediaType: 'image/png', data: 'iVBORw0KGgo=' }] })]))
    expect(q('.cv-thumb')).not.toBeNull()
    expect(q('.cv-thumb img')).toBeNull()
    await act(async () => observers[0].cb([{ isIntersecting: true, target: observers[0].seen[0] } as IntersectionObserverEntry], {} as IntersectionObserver))
    expect(q<HTMLImageElement>('.cv-thumb img')?.src).toBe('data:image/png;base64,iVBORw0KGgo=')

    await click(q('.cv-thumb'))
    expect(q('.cv-lightbox img')).not.toBeNull()
    await act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(q('.cv-lightbox')).toBeNull()
  } finally {
    vi.unstubAllGlobals()
  }
})

// ---- the pure parts ---------------------------------------------------------------------------

test('the pending card is the first unresolved call since the last typed prompt', () => {
  const cards = [tool('old', 0, 'Bash', null), user('u1', 1, 'go'), tool('t1', 2, 'Read', { kind: 'text', text: '' }), tool('t2', 3, 'Bash', null), tool('t3', 4, 'Edit', null)]
  expect(pendingCard(cards, null)).toBeNull()
  expect(pendingCard(cards, 'permission')).toEqual({ id: 't2', kind: 'permission' })
  expect(pendingCard(cards, 'question')).toEqual({ id: 't2', kind: 'question' })
  expect(pendingCard([...cards, user('q', 5, 'later', { queued: true })], 'permission')?.id).toBe('t2')
  expect(pendingCard([...cards, user('u2', 5, 'new prompt')], 'permission')).toBeNull()
})

test('the working clock counts from the prompt unless the session went idle after it', () => {
  const prompt = at(0)
  expect(workingSince(prompt, null, T0 + 60_000)).toBe(T0)
  expect(workingSince(prompt, T0 + STATUS_LAG_MS, T0 + STATUS_LAG_MS)).toBe(T0)
  expect(workingSince(prompt, T0 + STATUS_LAG_MS + 1000, T0 + 90_000)).toBe(T0 + 90_000)
  expect(workingSince(null, null, T0 + 5)).toBe(T0 + 5)
  expect([clockText(42_000), clockText(723_000), clockText(3_723_000), clockText(-5)]).toEqual(['0:42', '12:03', '1:02:03', '0:00'])
})

test('rows prepended above the first lower the first index by as many; a replaced list keeps it', () => {
  const it = (key: string): Item => ({ kind: 'note', key, text: key })
  expect(firstIndex(null, [it('a')], 100)).toBe(100)
  const prev = { items: [it('c'), it('d')], first: 100 }
  expect(firstIndex(prev, [it('a'), it('b'), it('c'), it('d')], 100)).toBe(98)
  expect(firstIndex(prev, [it('c'), it('d'), it('e')], 100)).toBe(100)
  expect(firstIndex(prev, [it('x')], 100)).toBe(100)
  // The first old row gone, the next one still there anchors.
  expect(firstIndex(prev, [it('a'), it('b'), it('d')], 100)).toBe(99)
})

test('markers with the same time and label still get distinct keys', () => {
  const seg = { ...newSegment(0, 's1'), state: 'live' as const }
  const items = streamItems([seg], [conv('s1', [])], [{ at: at(1), label: 'blocked' }, { at: at(1), label: 'blocked' }], undefined)
  const keys = items.filter((i) => i.kind === 'marker').map((i) => i.key)
  expect(new Set(keys).size).toBe(2)
})

test('an earlier chunk that crossed a reset is dropped', () => {
  let seg = applyEvent(newSegment(0, 's1'), lines(4000, [user('u1', 0, 'x')]))
  expect(seg.start).toBe(4000)
  const gen = seg.gen
  seg = applyEvent(applyEvent({ ...seg, loadingEarlier: true }, { kind: 'reset' }), lines(0, [user('u2', 0, 'y')]))
  const after = applyEarlier(seg, { start: 0, end: 4000, lines: [line(user('old', 0, 'old'))] }, gen, 4000)
  expect(after.records).toHaveLength(1)
  expect(after.loadingEarlier).toBe(false)
  expect(applyEvent(seg, { kind: 'missing' })).toBe(seg)
})

// ---- the face ---------------------------------------------------------------------------------

const PANE = 5
/** The face without chat-input's parts, whether or not they have landed: what the stream says
 *  must not hang on them (chat.test.tsx drives the foot with its own). */
const Face = () => (
  <ChatInputContext.Provider value={{}}>
    <ConversationFace paneId={PANE} />
  </ChatInputContext.Provider>
)
function paneIn(over: Partial<import('../layout/store').Pane> = {}) {
  store.setState({
    tabs: [{ id: 't', root: leaf(PANE), focused: PANE }],
    activeTab: 't',
    panes: { [PANE]: { id: PANE, view: 'terminal', cwd: '/repo', sessionId: 's1', face: 'conversation', ...over } },
  })
}
const snapWith = (status: string, waiting_for?: string | null): Snapshot => ({
  repos: [{ root: '/repo', name: 'repo', parents: [parent({ session_id: 's1', status, cwd: '/repo', waiting_for })], missions: [], children: [] }],
  errors: [],
  at: '',
})
/** Rows of `claude agents --json --all` (Claude Code 2.1.281) while a session sat on an
 *  AskUserQuestion, a plan approval, a Bash permission and `/config`, in that order. */
const [asking, planning, allowing, configuring] = agentsWaiting

test('the face follows the pane session under its cwd, with its status from the mission snapshot', async () => {
  paneIn()
  missionStore.setState({ snapshot: snapWith('busy') })
  const follow = vi.spyOn(tauriConversation, 'follow').mockImplementation(async (_s, _c, _t, on) => {
    on(lines(0, [user('u1', 0, 'hello')]))
    return () => {}
  })
  await render(<Face />)
  expect(follow).toHaveBeenCalledWith('s1', '/repo', TAIL, expect.any(Function))
  expect(q('.conversation-face .cv-bubble')?.textContent).toBe('hello')
  expect(q('.cv-working')).not.toBeNull()
})

test('with no session the face says so and how to go back', async () => {
  paneIn({ sessionId: undefined })
  await render(<Face />)
  expect(text()).toContain('No Claude session in this pane')
  expect(text()).toContain('⌘⇧C')
})

test('open terminal flips the pane to its terminal face and gives the xterm the keys', async () => {
  paneIn()
  missionStore.setState({ snapshot: snapWith(allowing.status, allowing.waitingFor) })
  vi.spyOn(tauriConversation, 'follow').mockImplementation(async (_s, _c, _t, on) => {
    on(lines(0, [user('u1', 0, 'go'), tool('t1', 1, 'Bash', null)]))
    return () => {}
  })
  // The terminal pane's body: the xterm, then the face over it.
  const body = document.createElement('div')
  body.className = 'pane-body'
  const xterm = document.createElement('textarea')
  xterm.className = 'xterm-helper-textarea'
  body.append(xterm)
  host.append(body)
  const inner = createRoot(body.appendChild(document.createElement('div')))
  await act(async () => inner.render(<Face />))
  expect(body.textContent).toContain('Waiting for approval')
  await act(async () => [...body.querySelectorAll('button')].find((b) => b.textContent === 'Open terminal')!.click())
  expect(store.getState().panes[PANE].face).toBe('terminal')
  expect(document.activeElement).toBe(xterm)
  act(() => inner.unmount())
})

test('the pane status reads busy and waiting off the parent of that session only', () => {
  const snap = snapWith('busy')
  expect(paneStatus(snap, 's1')).toEqual({ busy: true, waiting: null, parked: false })
  expect(paneStatus(snap, 'other')).toBeUndefined()
  expect(paneStatus(snap, undefined)).toBeUndefined()
  expect(paneStatus(snapWith('idle'), 's1')).toEqual({ busy: false, waiting: null, parked: false })
  expect(paneStatus(snapWith(asking.status, asking.waitingFor), 's1')).toEqual({ busy: false, waiting: 'question', parked: false })
  // `/config` parks the session on nothing a card can answer.
  expect(paneStatus(snapWith(configuring.status, configuring.waitingFor), 's1')).toEqual({ busy: false, waiting: null, parked: true })
})

test('what the pane waits for is what claude agents says it waits for', () => {
  expect(agentsWaiting.map((r) => [r.status, r.waitingFor])).toEqual([
    ['waiting', 'input needed'],
    ['waiting', 'permission prompt'],
    ['waiting', 'permission prompt'],
    ['waiting', 'dialog open'],
  ])
  expect(waitingKind(asking.status, asking.waitingFor)).toBe('question')
  // A plan approval is a permission prompt to `claude agents`: nothing there tells it from a Bash one.
  expect(waitingKind(planning.status, planning.waitingFor)).toBe('permission')
  expect(waitingKind(allowing.status, allowing.waitingFor)).toBe('permission')
  // `/config` holds the keys, but no tool call waits on it.
  expect(waitingKind(configuring.status, configuring.waitingFor)).toBeNull()
  // Values Claude Code 2.1.281 writes that no probe caught.
  expect(waitingKind('waiting', 'sandbox request')).toBe('permission')
  expect(waitingKind('waiting', 'goal proposal')).toBeNull()
  // A snapshot from before the pane carried `waiting_for` reads as it did.
  expect(waitingKind('waiting', undefined)).toBe('permission')
  expect(waitingKind('waiting', null)).toBe('permission')
  for (const s of ['busy', 'idle', 'unknown']) expect(waitingKind(s, 'permission prompt')).toBeNull()
})

const pendingIn = async (row: { status: string; waitingFor: string }, name: string) => {
  paneIn()
  missionStore.setState({ snapshot: snapWith(row.status, row.waitingFor) })
  vi.spyOn(tauriConversation, 'follow').mockImplementation(async (_s, _c, _t, on) => {
    on(lines(0, [user('u1', 0, 'go'), tool('t1', 1, name, null)]))
    return () => {}
  })
  await render(<Face />)
  // The face's foot answers it, so the stream only marks the call (a question and a plan are
  // rows of their own that say it).
  return (q('.cv-pending [data-mark="pending"]') ?? q('.cv-pending-bar'))?.textContent?.toLowerCase() ?? null
}

test.each([
  ['an AskUserQuestion', asking, 'AskUserQuestion', 'waiting for your answer'],
  ['a plan approval', planning, 'ExitPlanMode', 'waiting for approval'],
  ['a Bash permission', allowing, 'Bash', 'waiting for approval'],
  // A long Bash still running while `/config` is open waits for no one's approval.
  ['a Bash running under /config', configuring, 'Bash', null],
])('the pending card agrees with what the pane waits for: %s', async (_, row, name, says) => {
  const bar = await pendingIn(row, name)
  if (says === null) expect(bar).toBeNull()
  else expect(bar).toContain(says)
})

// ---- the pane bar -----------------------------------------------------------------------------

test('a terminal pane bar toggles the face and shows the current one; other panes have no toggle', async () => {
  paneIn({ face: undefined })
  const sessions = { pid: async () => null, session: async () => null }
  const git = { repo: async () => null, branch: async () => null }
  await render(<PaneBar id={PANE} client={git} sessions={sessions} />)
  const toggle = () => q('.pane-bar-face')
  expect(toggle()?.title).toBe('Toggle conversation (⌘⇧C)')
  expect(toggle()?.textContent).toBe('terminal')
  await click(toggle())
  expect(store.getState().panes[PANE].face).toBe('conversation')
  expect(toggle()?.textContent).toBe('conversation')
  expect(toggle()?.getAttribute('aria-pressed')).toBe('true')
  await click(toggle())
  expect(store.getState().panes[PANE].face).toBe('terminal')

  await act(async () => store.setState({ panes: { [PANE]: { id: PANE, view: 'editor' } } }))
  expect(toggle()).toBeNull()
})

// ---- usage ------------------------------------------------------------------------------------

function usageRig() {
  const layout = createStore({ spawn: async () => 1, write: async () => {}, resize: async () => {}, kill: async () => {} } as never)
  layout.setState({
    tabs: [{ id: 't', root: leaf(3), focused: 3 }],
    activeTab: 't',
    panes: { 3: { id: 3, view: 'terminal', sessionId: 's1' }, [-1]: { id: -1, view: 'vault' } },
  })
  const rows: Record<string, unknown>[] = []
  let beat = () => {}
  let focus = true
  const deps: UsageDeps = {
    layout,
    log: (r) => void rows.push(r),
    hasFocus: () => focus,
    every: (ms, fn) => {
      expect(ms).toBe(BEAT_MS)
      beat = fn
      return () => (beat = () => {})
    },
  }
  const stop = startUsage(deps)
  return { layout, rows, beat: () => beat(), blur: () => (focus = false), stop }
}

test('every face change is logged with whether the pane runs a session', () => {
  const u = usageRig()
  u.layout.getState().setFace(3, 'conversation')
  u.layout.getState().setTitle(3, 'noise')
  u.layout.getState().setFace(3, 'conversation')
  u.layout.getState().setFace(3, 'terminal')
  u.layout.getState().setSessionId(3, undefined)
  u.layout.getState().setFace(3, 'conversation')
  expect(u.rows).toEqual([
    { event: 'face', face: 'conversation', session: true },
    { event: 'face', face: 'terminal', session: true },
    { event: 'face', face: 'conversation', session: false },
  ])
  u.stop()
  u.layout.getState().setFace(3, 'terminal')
  expect(u.rows).toHaveLength(3)
})

test('a beat logs the focused terminal pane face while the window has focus, and nothing otherwise', () => {
  const u = usageRig()
  u.beat()
  u.layout.getState().setFace(3, 'conversation')
  u.beat()
  expect(u.rows.filter((r) => r.event === 'beat')).toEqual([
    { event: 'beat', face: 'terminal' },
    { event: 'beat', face: 'conversation' },
  ])
  u.layout.setState((s) => ({ tabs: [{ ...s.tabs[0], focused: -1 }] }))
  u.beat()
  u.layout.setState((s) => ({ tabs: [{ ...s.tabs[0], focused: 3 }] }))
  u.blur()
  u.beat()
  expect(u.rows.filter((r) => r.event === 'beat')).toHaveLength(2)
  u.stop()
  u.beat()
  expect(u.rows.filter((r) => r.event === 'beat')).toHaveLength(2)
})

test('the counter runs from the moment the face module loads, against the app store', async () => {
  const log = vi.spyOn(tauriConversation, 'logUsage').mockResolvedValue()
  paneIn({ face: undefined })
  await act(async () => store.getState().setFace(PANE, 'conversation'))
  expect(log).toHaveBeenCalledWith({ event: 'face', face: 'conversation', session: true })
})
