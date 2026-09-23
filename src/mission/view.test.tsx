import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'

const timeline = vi.hoisted(() => ({ lines: [] as { at: string; state: string; detail: string; text: string }[] }))
const memory = vi.hoisted(
  () => ({ value: null }) as { value: { briefing: unknown; injected: unknown[]; friction: unknown[]; mcp_reads: unknown } | null },
)
// The conversation view is another piece's (round 20 · view): the pane is tested on what it
// hands it, read back from this stand-in, never on how it draws a transcript.
const conversation = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }))
vi.mock('../conversation/ConversationView', () => ({
  ConversationView: (props: { sessionId: string | null; markers?: { at: string; label: string }[]; footer?: unknown }) => {
    conversation.props = props
    return (
      <div className="conversation-stub">
        {(props.markers ?? []).map((m) => (
          <div key={m.at + m.label} className="stub-marker">{m.label}</div>
        ))}
        <div className="stub-footer">{props.footer as never}</div>
      </div>
    )
  },
}))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === 'child_memory') return memory.value ?? { briefing: null, injected: [], friction: [], mcp_reads: null }
    return { lines: timeline.lines, total: timeline.lines.length }
  }),
}))

import { missionStore } from './app-store'
import { paneView } from '../panes/registry'
import { snapshot } from './fixtures'
import { allChildren, type ChildSession } from './types'
import { store as appStore } from '../layout/app-store'
import type { SessionStatus } from '../conversation/types'
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
  missionStore.setState({ snapshot, lastError: null, looked: {}, drafts: {}, sent: {} })
  timeline.lines = []
  memory.value = null
  conversation.props = null
})

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
  expect(host.querySelector('.mission-pane')).not.toBeNull()
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
  expect(host.querySelector('.m-model')?.textContent).toBe('haiku · high effort')
  expect(host.textContent).toContain('~$2.50')
  await act(async () => {
    root.render(<Pane id={2} props={{ id: lean.id }} />)
  })
  expect(host.querySelector('.m-model')?.textContent).toBe('default model · default effort')
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
  expect(host.querySelector('.mission-head')?.textContent).toContain(c.id)
})

test('the status handed to the conversation follows the child: working, parked on a permission, a question', async () => {
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
  expect(await statusOf({ tempo: 'blocked', needs: 'which crate?', waiting_for: null })).toEqual({ busy: false, waiting: 'question' })
  expect(await statusOf({ state: 'done' })).toEqual({ busy: false, waiting: null })
})

test('a blocked child keeps its reply box, pinned under the conversation as its footer', async () => {
  const blocked = allChildren(snapshot).find((c) => c.tempo === 'blocked')!
  const Pane = paneView('mission')!
  await act(async () => {
    root.render(<Pane id={1} props={{ id: blocked.id }} />)
  })
  const reply = host.querySelector('.stub-footer .mission-reply')
  expect(reply).not.toBeNull()
  expect(reply?.textContent).toContain('may I add a crate?')
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
  expect(host.querySelector('.cmem')?.textContent).toBe('memory: no session yet')
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
