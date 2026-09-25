import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'

const timeline = vi.hoisted(() => ({ lines: [] as { at: string; state: string; detail: string; text: string }[] }))
const memory = vi.hoisted(
  () => ({ value: null }) as { value: { briefing: unknown; injected: unknown[]; friction: unknown[]; mcp_reads: unknown } | null },
)
// The conversation view is another piece's (round 20 · view): the pane is tested on what it
// hands it, read back from this stand-in, never on how it draws a transcript.
const conversation = vi.hoisted(() => ({ props: null as null | Record<string, unknown>, parked: null as unknown }))
// Like the real view, the stand-in draws the foot's composer from the chat-input context when it
// is given an agent and the session waits on no dialog, and hands the footer what it is parked on.
vi.mock('../conversation/ConversationView', async () => {
  const { useContext } = await import('react')
  const { ChatInputContext } = await import('../conversation/chat-input')
  return {
    ConversationView: (props: {
      sessionId: string | null
      cwd: string
      markers?: { at: string; label: string }[]
      footer?: unknown
      status?: { waiting: string | null; parked?: boolean }
      agent?: { send(text: string): Promise<void> }
    }) => {
      conversation.props = props
      const { Composer } = useContext(ChatInputContext)
      const footer = typeof props.footer === 'function' ? (props.footer as (p: unknown) => unknown)(conversation.parked) : props.footer
      const foot = props.agent && props.sessionId && !props.status?.waiting && !props.status?.parked && Composer
      return (
        <div className="conversation-stub">
          {(props.markers ?? []).map((m) => (
            <div key={m.at + m.label} className="stub-marker">{m.label}</div>
          ))}
          {foot && (
            <div className="stub-foot">
              <Composer cwd={props.cwd} placeholder="Message Claude…" onSend={props.agent!.send} />
            </div>
          )}
          <div className="stub-footer">{footer as never}</div>
        </div>
      )
    },
  }
})
// A plain recorder, not vi.fn(): what the pane asked the core for, in order.
const ipc = vi.hoisted(() => ({ calls: [] as [string, Record<string, unknown> | undefined][] }))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args?: Record<string, unknown>) => {
    ipc.calls.push([cmd, args])
    if (cmd === 'child_memory') return memory.value ?? { briefing: null, injected: [], friction: [], mcp_reads: null }
    if (cmd === 'mission_reply') return null
    if (cmd === 'settings_read') return {}
    return { lines: timeline.lines, total: timeline.lines.length }
  },
}))
// The composer and approval card are the chat-input piece's: stand-ins that keep the props the
// pane handed them.
type Props = Record<string, unknown>
const chat = vi.hoisted(() => ({ composer: null as null | Props, approval: null as null | Props }))
vi.mock('../chat-input/Composer', () => ({
  ChatComposer: (props: Props) => {
    chat.composer = props
    return <div className="composer-stub" data-placeholder={String(props.placeholder)} data-disabled={String(props.disabled)} />
  },
}))
vi.mock('../chat-input/ApprovalCard', () => ({
  ApprovalCard: (props: Props) => {
    chat.approval = props
    return <div className="approval-stub">{`${props.tool} | ${props.summary}`}</div>
  },
}))
// Answering a prompt types into `claude attach`: recorded here, its outcome set per test.
const answers = vi.hoisted(() => ({ calls: [] as [string, string][], phase: 'sent' as 'sent' | 'error' }))
vi.mock('../cockpit/approve', async (orig) => ({
  ...(await orig<typeof import('../cockpit/approve')>()),
  answerPrompt: async (c: { id: string }, choice: string) => {
    answers.calls.push([c.id, choice])
    return answers.phase === 'error'
      ? { choice, phase: 'error', pane: null, error: 'the prompt did not appear in the attach', at: Date.now() }
      : { choice, phase: 'sent', pane: 3, at: Date.now() }
  },
}))

import { missionStore } from './app-store'
import { paneView } from '../panes/registry'
import { snapshot } from './fixtures'
import { allChildren, type ChildSession } from './types'
import { store as appStore } from '../layout/app-store'
import type { SessionStatus } from '../conversation/types'
import { settingsStore } from '../settings/app-store'
import { routeStore } from './agent'
import './view'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** The fixture snapshot with one child replaced, wherever it is listed. */
function withChild(next: ChildSession) {
  const swap = (c: ChildSession) => (c.id === next.id ? next : c)
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
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  missionStore.setState({ snapshot, lastError: null, looked: {}, drafts: {}, sent: {}, replyErrors: {}, sending: {}, typing: {} })
  // Sent as typed: the English rewrite would ask the core for a translation first.
  settingsStore.setState({ outgoing: 'as-typed', replyLanguage: 'unchanged' })
  timeline.lines = []
  memory.value = null
  conversation.props = null
  conversation.parked = null
  routeStore.setState({ routes: {} })
  ipc.calls = []
  chat.composer = null
  chat.approval = null
  answers.calls = []
  answers.phase = 'sent'
})

async function mount(id: string) {
  const Pane = paneView('mission')!
  await act(async () => {
    root.render(<Pane id={1} props={{ id }} />)
  })
}

/** The footer the pane handed the conversation, rendered by the stand-in. */
const footer = () => host.querySelector('.stub-footer')!
/** The foot's composer, as the conversation draws it from the pane's chat-input parts. */
const foot = () => host.querySelector('.stub-foot')

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

// Regression for the black screen: opening a child you never replied to (every
// active or done row) mounted a pane whose selector returned a fresh array on
// every store read, so React's external-store hook looped until it threw and
// unmounted the whole app. The pane must survive mount plus a poll tick.
test('mission pane survives a store notification for a child with no replies', async () => {
  const child = allChildren(snapshot).find((c) => c.state === 'done') ?? allChildren(snapshot)[0]
  expect(missionStore.getState().sent[child.id]).toBeUndefined()
  const Pane = paneView('mission')!
  await act(async () => {
    root.render(<Pane id={1} props={{ id: child.id }} />)
  })
  // What the sidebar poll does three times every 3 s.
  await act(async () => {
    missionStore.setState({ polling: true })
    missionStore.setState({ snapshot: { ...snapshot, at: '2026-09-15T12:00:03Z' } })
    missionStore.setState({ polling: false })
  })
  expect(host.querySelector('.ms-pane')).not.toBeNull()
  expect(host.textContent).toContain(child.id)
})

test('a poll that changes nothing about the child does not re-mark it as looked', async () => {
  const child = allChildren(snapshot)[0]
  const markLooked = vi.fn(async () => {})
  missionStore.setState({ markLooked })
  const Pane = paneView('mission')!
  await act(async () => {
    root.render(<Pane id={1} props={{ id: child.id }} />)
  })
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      // Rust hands the frontend a new object graph on every snapshot, same content.
      missionStore.setState({ snapshot: JSON.parse(JSON.stringify(snapshot)) })
    })
  }
  expect(markLooked).toHaveBeenCalledTimes(1)
})

test('the pane shows the child model and prices it at that model, and says default when there is none', async () => {
  const [first, second] = allChildren(snapshot)
  const haiku = { ...first, model: 'haiku', effort: 'high', tokens: 1_000_000 }
  const lean = { ...second, model: null, effort: null, tokens: 1_000_000 }
  const swap = (c: typeof first) => (c.id === haiku.id ? haiku : c.id === lean.id ? lean : c)
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
  const Pane = paneView('mission')!
  await act(async () => {
    root.render(<Pane id={1} props={{ id: haiku.id }} />)
  })
  expect(host.querySelector('.ms-model')?.textContent).toBe('haiku · high effort')
  expect(host.textContent).toContain('~$2.50')
  await act(async () => {
    root.render(<Pane id={2} props={{ id: lean.id }} />)
  })
  expect(host.querySelector('.ms-model')?.textContent).toBe('default model · default effort')
  expect(host.textContent).toContain('~$30.00')
})

// Round 20: the timeline gave way to the child's conversation. Its status lines are thin
// markers in that stream, one per change; what was sent and the report are in the transcript.
test('the pane shows the child conversation, with one marker per status change and no timeline', async () => {
  const [first] = allChildren(snapshot)
  const c = { ...first, session_id: 'sess-a43d' }
  withChild(c)
  const l = (at: string, state: string, detail: string, text = '') => ({ at, state, detail, text })
  timeline.lines = [
    l('2026-09-15T17:10:00Z', 'blocked', 'awaiting task specification'),
    l('2026-09-15T17:23:00Z', 'blocked', 'awaiting task clarification'),
    l('2026-09-15T17:24:00Z', 'blocked', 'awaiting task clarification'),
    l('2026-09-15T17:30:00Z', 'done', '', 'the final report'),
  ]
  missionStore.setState({ sent: { [c.id]: [{ at: Date.parse('2026-09-15T17:16:42Z'), text: 'go ahead', original: 'go ahead' }] } })
  const Pane = paneView('mission')!
  await act(async () => {
    root.render(<Pane id={1} props={{ id: c.id }} />)
  })
  expect(conversation.props).toMatchObject({ sessionId: 'sess-a43d', cwd: c.cwd })
  expect(conversation.props?.markers).toEqual([
    { at: '2026-09-15T17:10:00Z', label: 'blocked · awaiting task specification' },
    { at: '2026-09-15T17:23:00Z', label: 'blocked · awaiting task clarification' },
    { at: '2026-09-15T17:30:00Z', label: 'done' },
  ])
  expect(host.querySelector('.mission-timeline')).toBeNull()
  expect(host.textContent).not.toContain('go ahead')
  expect(host.textContent).not.toContain('the final report')
  // The head stays.
  expect(host.querySelector('.ms-head')?.textContent).toContain(c.id)
})

test('the status handed to the conversation follows the child: only a dialog the chat answers is waiting', async () => {
  const [first] = allChildren(snapshot)
  const Pane = paneView('mission')!
  const statusOf = async (over: Partial<ChildSession>) => {
    withChild({ ...first, ...over })
    await act(async () => {
      root.render(<Pane id={1} props={{ id: first.id }} />)
    })
    return conversation.props?.status as SessionStatus
  }
  expect(await statusOf({ tempo: 'active', needs: null })).toEqual({ busy: true, waiting: null })
  expect(await statusOf({ tempo: 'blocked', needs: 'approve Bash: rm -rf build' })).toEqual({ busy: false, waiting: 'permission' })
  expect(await statusOf({ tempo: 'blocked', needs: 'which crate?', waiting_for: 'permission prompt' })).toEqual({ busy: false, waiting: 'permission' })
  // Asked as it ended its turn: nothing but a reply answers it, so the composer shows.
  expect(await statusOf({ tempo: 'blocked', needs: 'which crate?', waiting_for: null })).toEqual({ busy: false, waiting: null })
  // The multiple-choice dialog: the foot's question card.
  expect(await statusOf({ tempo: 'blocked', needs: 'which crate?', waiting_for: 'input needed' })).toEqual({ busy: false, waiting: 'question' })
  // `claude agents` is fresher than the tempo.
  expect(await statusOf({ tempo: 'active', needs: null, waiting_for: 'input needed' })).toEqual({ busy: false, waiting: 'question' })
  // A dialog no card answers: the terminal does.
  expect(await statusOf({ tempo: 'blocked', needs: null, waiting_for: 'dialog open' })).toEqual({ busy: false, waiting: null, parked: true })
  expect(await statusOf({ state: 'done' })).toEqual({ busy: false, waiting: null })
})

test('the conversation is given the child agent: every answer, and no shell mode', async () => {
  const [first] = allChildren(snapshot)
  withChild({ ...first, session_id: 'sess-a43d' })
  await mount(first.id)
  const agent = conversation.props?.agent as Record<string, unknown>
  expect(Object.keys(agent).sort()).toEqual(['allow', 'answer', 'deny', 'other', 'send'])
  // A poll hands the pane a new child object; the agent stays, so the foot keeps its state.
  await act(async () => missionStore.setState({ snapshot: JSON.parse(JSON.stringify(missionStore.getState().snapshot)) }))
  expect(conversation.props?.agent).toBe(agent)
})

test('open terminal on the pending card attaches to the child beside the pane', async () => {
  const [first] = allChildren(snapshot)
  const openView = vi.fn()
  const real = appStore.getState().openView
  appStore.setState({ openView })
  try {
    const Pane = paneView('mission')!
    await act(async () => {
      root.render(<Pane id={1} props={{ id: first.id }} />)
    })
    ;(conversation.props?.onOpenTerminal as () => void)()
    expect(openView).toHaveBeenCalledWith('terminal-cmd', { cmd: `claude attach ${first.id}` }, 'split-col', `attach ${first.id}`)
  } finally {
    appStore.setState({ openView: real })
  }
})

test('a child with no session yet shows the mission pane says so, and fetches no memory', async () => {
  const child = allChildren(snapshot).find((c) => c.session_id === null)!
  timeline.lines = [{ at: '2026-09-15T17:10:00Z', state: 'working', detail: 'starting', text: '' }]
  const Pane = paneView('mission')!
  await act(async () => {
    root.render(<Pane id={1} props={{ id: child.id }} />)
  })
  expect(host.querySelector('.cmem')?.textContent).toBe('Memory: no session yet')
  // It still gets the conversation (its empty state) and its markers.
  expect(conversation.props).toMatchObject({ sessionId: null, markers: [{ at: '2026-09-15T17:10:00Z', label: 'working' }] })
})

test('a child with a session_id shows what the vault gave it and what it pushed back against', async () => {
  const [first] = allChildren(snapshot)
  const withSession = { ...first, session_id: 'sess-a43d' }
  missionStore.setState({
    snapshot: {
      ...snapshot,
      repos: snapshot.repos.map((r) => ({
        ...r,
        children: r.children.map((c) => (c.id === withSession.id ? withSession : c)),
        missions: r.missions.map((m) => ({
          ...m,
          pieces: m.pieces.map((p) => ({ ...p, child: p.child?.id === withSession.id ? withSession : p.child })),
        })),
      })),
    },
  })
  memory.value = {
    briefing: { path: 'bots/mnemo-desktop/briefings/sessions/aa11.md', at: Date.now() },
    injected: [{ slug: 'run-the-tests', at: Date.now() }],
    friction: [{ rule_text: 'Ask before rewriting a whole file.', contradicts: ['some-stale-rule'], injected_in_session: [], at: Date.now() }],
    mcp_reads: null,
  }
  const Pane = paneView('mission')!
  await act(async () => {
    root.render(<Pane id={1} props={{ id: withSession.id }} />)
  })
  expect(host.querySelector('.cmem-briefing')?.textContent).toContain('aa11.md')
  expect(host.querySelector('.cmem-slug')?.textContent).toBe('run-the-tests')
  expect(host.querySelector('.cmem-rule-text')?.textContent).toBe('Ask before rewriting a whole file.')
})

test('on a permission the foot has no card for yet, the footer answers it through claude attach', async () => {
  const [first] = allChildren(snapshot)
  const c = { ...first, tempo: 'blocked', needs: 'approve Bash: cargo test \\\n  --workspace' }
  withChild(c)
  await mount(c.id)
  expect(foot()).toBeNull()
  expect(chat.approval).toMatchObject({ tool: 'Bash', summary: 'cargo test \\', detail: 'cargo test \\\n  --workspace' })
  await act(async () => (chat.approval!.onAllow as () => Promise<void>)())
  await act(async () => (chat.approval!.onDeny as () => Promise<void>)())
  expect(answers.calls).toEqual([
    [c.id, 'yes'],
    [c.id, 'no'],
  ])
  // "Don't ask again" is not on the card: it stays one click away under it.
  await act(async () => footer().querySelector<HTMLButtonElement>('.ms-always')!.click())
  expect(answers.calls.at(-1)).toEqual([c.id, 'always'])
})

test('once the transcript shows the call, the foot card answers it and the footer only offers "don\'t ask again"', async () => {
  const [first] = allChildren(snapshot)
  const c = { ...first, tempo: 'blocked', needs: 'approve Bash: cargo test' }
  withChild(c)
  conversation.parked = { tool: { id: 'toolu_1', kind: 'tool', name: 'Bash' }, kind: 'permission' }
  await mount(c.id)
  expect(chat.approval).toBeNull()
  expect(footer().querySelector('.ms-always')).not.toBeNull()
  // The foot's Approve / Deny go through the agent, to the same attach.
  const agent = conversation.props?.agent as { allow(): Promise<void>; deny(): Promise<void> }
  await act(async () => agent.allow())
  await act(async () => agent.deny())
  expect(answers.calls).toEqual([
    [c.id, 'yes'],
    [c.id, 'no'],
  ])
  answers.phase = 'error'
  await expect(agent.allow()).rejects.toThrow('the prompt did not appear in the attach')
})

test('a one-line ask has no detail, and a failed answer rejects so the card can say so', async () => {
  const [first] = allChildren(snapshot)
  withChild({ ...first, tempo: 'blocked', needs: null, waiting_for: 'permission prompt' })
  await mount(first.id)
  expect(chat.approval).toMatchObject({ tool: 'Permission', summary: 'permission prompt', detail: undefined })
  answers.phase = 'error'
  await expect((chat.approval!.onAllow as () => Promise<void>)()).rejects.toThrow('the prompt did not appear in the attach')
})

test('a child parked on the multiple-choice dialog gets no composer and no footer: the foot asks it', async () => {
  const [first] = allChildren(snapshot)
  withChild({ ...first, session_id: 'sess-a43d', tempo: 'blocked', needs: 'which colour?', waiting_for: 'input needed' })
  await mount(first.id)
  expect(foot()).toBeNull()
  expect(chat.composer).toBeNull()
  expect(footer().textContent).toBe('')
})

/** Swaps the store's reply routes for recorders; the real ones need the core. */
function recordReplies() {
  const calls: [string, string, string | null | undefined][] = []
  const real = { replyAsMe: missionStore.getState().replyAsMe, sendReply: missionStore.getState().sendReply }
  let refuse: string | null = null
  missionStore.setState({
    replyAsMe: async (id, suggested) => {
      calls.push(['as-me', missionStore.getState().drafts[id], suggested])
      if (refuse) missionStore.setState({ replyErrors: { [id]: refuse } })
      return !refuse
    },
    sendReply: async (id) => {
      calls.push(['message', missionStore.getState().drafts[id], undefined])
      return true
    },
  })
  return { calls, refuse: (why: string) => (refuse = why), restore: () => missionStore.setState(real) }
}

test('a child that asked as it ended its turn gets the composer under its question, sending as me by default', async () => {
  const blocked = { ...allChildren(snapshot).find((c) => c.tempo === 'blocked')!, session_id: 'sess-b' }
  withChild(blocked)
  const r = recordReplies()
  try {
    await mount(blocked.id)
    expect(chat.approval).toBeNull()
    expect(foot()?.querySelector('.ms-needs')?.textContent).toBe('may I add a crate?')
    expect(foot()?.querySelector('.ms-suggested')?.textContent).toBe('Suggested: yes')
    expect(foot()?.querySelector('[data-route="as-me"]')?.getAttribute('aria-checked')).toBe('true')
    expect(chat.composer).toMatchObject({ cwd: blocked.cwd, disabled: false, placeholder: 'Answer the child, as you…' })
    // No `!`: a child has no shell mode.
    expect(chat.composer?.onBash).toBeUndefined()
    await act(async () => (chat.composer!.onSend as (t: string) => Promise<void>)('use serde'))
    expect(r.calls).toEqual([['as-me', 'use serde', 'yes']])
    expect(ipc.calls.some(([cmd]) => cmd === 'mission_reply')).toBe(false)
    // A refusal rejects the send, so the composer keeps the text and says why.
    r.refuse("this is the child's suggested reply, not yours")
    await expect((chat.composer!.onSend as (t: string) => Promise<void>)('yes')).rejects.toThrow("this is the child's suggested reply")
  } finally {
    r.restore()
  }
})

test('message is the second choice, and it holds for the next send', async () => {
  const blocked = { ...allChildren(snapshot).find((c) => c.tempo === 'blocked')!, session_id: 'sess-b' }
  withChild(blocked)
  const r = recordReplies()
  try {
    await mount(blocked.id)
    await act(async () => foot()!.querySelector<HTMLButtonElement>('[data-route="message"]')!.click())
    expect(foot()?.querySelector('[data-route="message"]')?.getAttribute('aria-checked')).toBe('true')
    expect(chat.composer?.placeholder).toBe('Answer the child…')
    await act(async () => (chat.composer!.onSend as (t: string) => Promise<void>)('use serde'))
    await act(async () => (chat.composer!.onSend as (t: string) => Promise<void>)('and toml'))
    expect(r.calls.map(([route, text]) => [route, text])).toEqual([
      ['message', 'use serde'],
      ['message', 'and toml'],
    ])
  } finally {
    r.restore()
  }
})

test('send it sends the suggested reply as a message', async () => {
  const blocked = { ...allChildren(snapshot).find((c) => c.tempo === 'blocked')!, session_id: 'sess-b' }
  withChild(blocked)
  await mount(blocked.id)
  await act(async () => foot()!.querySelector<HTMLButtonElement>('.ms-send-suggested')!.click())
  expect(ipc.calls).toContainEqual(['mission_reply', { id: blocked.id, text: 'yes' }])
})

test('a working child still takes a reply; a child that is not running gets a disabled composer and refuses', async () => {
  const [first] = allChildren(snapshot)
  withChild({ ...first, session_id: 'sess-a43d' })
  await mount(first.id)
  expect(foot()?.querySelector('.ms-question')).toBeNull()
  expect(chat.composer).toMatchObject({ disabled: false, placeholder: `Type into claude attach ${first.id}, as you…` })
  withChild({ ...first, session_id: 'sess-a43d', live: false })
  await mount(first.id)
  expect(chat.composer).toMatchObject({ disabled: true, placeholder: 'The child is not running: nothing reaches it' })
  await expect((conversation.props?.agent as { send(t: string): Promise<void> }).send('hello')).rejects.toThrow('not running')
})

test('the head is new UI: take over attaches beside the pane, stop asks once more before claude stop', async () => {
  const [first] = allChildren(snapshot)
  const openView = vi.fn()
  const real = appStore.getState().openView
  appStore.setState({ openView })
  try {
    await mount(first.id)
    const head = host.querySelector('.ms-head')!
    expect(head.hasAttribute('data-ui')).toBe(true)
    expect(head.querySelector('[data-state-dot]')?.getAttribute('data-state-dot')).toBe('working')
    await act(async () => head.querySelector<HTMLButtonElement>('.ms-take-over')!.click())
    expect(openView).toHaveBeenLastCalledWith('terminal-cmd', { cmd: `claude attach ${first.id}` }, 'split-col', `attach ${first.id}`)
    const stop = head.querySelector<HTMLButtonElement>('.ms-stop')!
    await act(async () => stop.click())
    expect(openView).toHaveBeenCalledTimes(1)
    expect(stop.textContent).toBe('Really stop?')
    await act(async () => stop.click())
    expect(openView).toHaveBeenLastCalledWith('terminal-cmd', { cmd: `claude stop ${first.id}` }, 'split-col', `stop ${first.id}`)
  } finally {
    appStore.setState({ openView: real })
  }
})

test('a blocked child reads as needing you in the head', async () => {
  const blocked = allChildren(snapshot).find((c) => c.tempo === 'blocked')!
  await mount(blocked.id)
  expect(host.querySelector('.ms-head [data-state-dot]')?.getAttribute('data-state-dot')).toBe('needs-you')
  expect(host.querySelector('.ms-word')?.textContent).toBe('needs you')
})
