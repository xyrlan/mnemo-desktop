import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'
import { createStore } from 'zustand/vanilla'

vi.mock('@tauri-apps/api/core', () => ({ invoke: async () => null, Channel: class {} }))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))

/** As in `src/conversation/chat.test.tsx`: a record `{type: 'card', card}` is one hand-built card. */
vi.mock('../../conversation/parse', async (orig) => {
  const real = await orig<typeof import('../../conversation/parse')>()
  return {
    ...real,
    deriveConversation: (records: import('../../conversation/types').TranscriptRecord[]) => ({
      sessionId: 's',
      title: null,
      prs: [],
      cards: records.filter((r) => r.type === 'card').map((r) => r.card),
      usage: null,
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

import { BACKSPACE, CLEAR_LINE, ENTER, makeChatPty, promptBytes } from '../../chat-input/pty'
import { ChatInputContext, type ChatInputParts } from '../../conversation/chat-input'
import type { ConversationClient } from '../../conversation/client'
import { ConversationView } from '../../conversation/ConversationView'
import type { ToolCard } from '../../conversation/stream'
import type { Card, FollowEvent } from '../../conversation/types'
import type { DiffClient } from '../../diff/client'
import type { PaneViewProps } from '../../panes/registry'
import type { Ship } from '../ship-types'
import { nexusStore } from '../store'
import { sessionAgent } from './agent'
import { NexusDrawer, type DrawerDeps } from './Drawer'
import { fakeHost, INPUT, PERMISSION, reposFixture, settle, shipFixture } from './fixtures'
import { openingOf } from './model'
import { createDrawer } from './sessions'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** The drawer with the app's conversation view and foot, on synthetic transcripts: what a
 *  session waits on is never hidden behind its conversation. */

const T0 = Date.parse('2026-10-15T10:00:00Z')
const at = (s: number) => new Date(T0 + s * 1000).toISOString()
const user = (id: string, text: string): Card => ({ kind: 'user', id, at: at(0), text, images: [], rules: [], queued: false })
const bash = (id: string, command: string): ToolCard => ({ kind: 'tool', id, at: at(1), toolUseId: `tu-${id}`, name: 'Bash', summary: command, input: { command }, outcome: null, images: [], rules: [] })

/** Each session's transcript, served once to its follow. */
const transcripts: Record<string, Card[]> = {}
const client: ConversationClient = {
  async follow(sessionId, _cwd, _tail, on) {
    const cards = transcripts[sessionId] ?? []
    const e: FollowEvent = { kind: 'lines', start: 0, end: cards.length, lines: cards.map((card) => JSON.stringify({ type: 'card', card })) }
    queueMicrotask(() => on(e))
    return () => {}
  },
  earlier: async () => ({ start: 0, end: 0, lines: [] }),
  logUsage: async () => {},
}

/** chat-input's parts, drawn as what they are, each answering through the foot. */
const PARTS: ChatInputParts = {
  Composer: ({ onSend }) => (
    <button type="button" data-fake-composer="" onClick={() => void onSend('ship it').catch(() => {})}>
      send
    </button>
  ),
  ApprovalCard: ({ summary, onAllow }) => (
    <button type="button" data-fake-approval={summary} onClick={() => void onAllow().catch(() => {})}>
      allow
    </button>
  ),
}

const typed: string[] = []
let screen = INPUT
const write = async (pty: number, d: string) => void typed.push(`${pty} ${JSON.stringify(d)}`)
const paneChat = makeChatPty({ writePty: write, paneRunsClaude: async () => true, sleep: async () => {} })
const sinks = {
  pane: { sendPrompt: paneChat.sendPrompt, sendBash: paneChat.sendBash, answerApproval: paneChat.answerApproval, answerQuestion: paneChat.answerQuestion },
  attach: { writePty: write, screen: () => screen, sleep: async () => {} },
}

const diff: DiffClient = { files: async (w) => ({ root: w, truncated: false, files: [] }), sides: async () => ({ original: '', modified: '', binary: false, tooLarge: false }) }
const Terminal = ({ id }: PaneViewProps) => (
  <div data-stub-terminal={id}>
    <textarea />
  </div>
)

let root: Root
async function mount(ship: Ship, ids: string[]) {
  const { host } = fakeHost()
  const drawer = createDrawer(host, nexusStore, { goToPane: () => {}, attach: () => {}, closeNexus: () => {} })
  const deps: DrawerDeps = {
    drawer,
    host,
    owners: createStore(() => ({ owners: {} })),
    terminal: Terminal,
    conversation: (p) => <ConversationView {...p} client={client} />,
    agent: (session) => sessionAgent(session, sinks),
    diff,
    worktreeOf: (cwd) => cwd,
    goToRepo: () => {},
    paneOfSession: () => null,
  }
  for (const id of ids) {
    const o = openingOf(id, ship, reposFixture)!
    act(() => drawer.open(o.tab, o.ref))
  }
  root = createRoot(document.body.appendChild(document.createElement('div')))
  act(() =>
    root.render(
      <ChatInputContext.Provider value={PARTS}>
        <NexusDrawer deps={deps} ship={ship} feed={null} repos={reposFixture} shown onOpen={() => {}} />
      </ChatInputContext.Provider>,
    ),
  )
  await act(settle)
  await act(settle)
  return { host }
}

const panel = (id: string) => document.querySelector<HTMLElement>(`[data-drawer-panel="${id}"]`)!
const conversation = (id: string) => panel(id).querySelector<HTMLElement>('[data-drawer-conversation]')!

/** The ship with robot `r-live` and captain `cap-1` waiting as given. */
function waiting(robot: string | null, captain: { status: string; waiting_for?: string | null } | null): Ship {
  const ship = shipFixture()
  const deck = ship.decks[0]
  if (robot) deck.flight[0] = { ...deck.flight[0], child: { ...deck.flight[0].child, waiting_for: robot } }
  if (captain) deck.captains[0] = { ...deck.captains[0], parent: { ...deck.captains[0].parent!, ...captain } }
  return ship
}

beforeEach(() => {
  typed.length = 0
  screen = INPUT
  for (const k of Object.keys(transcripts)) delete transcripts[k]
  nexusStore.setState({ open: true, tabs: [], activeTab: null, collapsed: false, focusId: null, drawerWidth: 600, faces: {} })
})
afterEach(() => {
  act(() => root.unmount())
  document.body.innerHTML = ''
})

test('a child waiting on a permission shows the card that answers it, typed into its attach, never the composer', async () => {
  transcripts['s-live'] = [user('u1', 'run the suite'), bash('t1', 'pnpm test')]
  const { host } = await mount(waiting('permission prompt', null), ['r-live'])
  const attach = host.getState().sessions['child:r-live'].pty!
  expect(panel('r-live').dataset.drawerFace).toBe('conversation')
  expect(conversation('r-live').querySelector('[data-fake-composer]')).toBeNull()
  const card = conversation('r-live').querySelector<HTMLButtonElement>('[data-fake-approval]')!
  expect(card.dataset.fakeApproval).toContain('pnpm test')
  screen = PERMISSION
  await act(async () => card.click())
  await act(settle)
  expect(typed).toEqual([`${attach} "1"`])
})

test('a dialog the conversation has no card for puts an Open terminal line where the composer was, and it shows the terminal', async () => {
  transcripts['cap-1'] = [user('u1', 'configure')]
  await mount(waiting(null, { status: 'waiting', waiting_for: 'dialog open' }), ['cap-1'])
  const foot = conversation('cap-1').querySelector<HTMLElement>('.cv-foot')!
  expect(foot.textContent).toContain('answer it in the terminal')
  expect(foot.querySelector('[data-fake-composer]')).toBeNull()
  act(() => [...foot.querySelectorAll('button')].find((b) => b.textContent === 'Open terminal')!.click())
  expect(panel('cap-1').dataset.drawerFace).toBe('terminal')
  expect(conversation('cap-1').style.visibility).toBe('hidden')
})

test('a permission whose call the transcript has not written yet is pointed at the terminal too, never answered blind', async () => {
  transcripts['cap-1'] = [user('u1', 'go')]
  await mount(waiting(null, { status: 'waiting', waiting_for: 'permission prompt' }), ['cap-1'])
  const foot = conversation('cap-1').querySelector<HTMLElement>('.cv-foot')!
  expect(foot.textContent).toContain('Claude Code is waiting for approval')
  expect(foot.querySelector('[data-fake-composer]')).toBeNull()
  expect([...foot.querySelectorAll('button')].some((b) => b.textContent === 'Open terminal')).toBe(true)
})

test('idle, the composer sends into the pane’s PTY', async () => {
  transcripts['cap-1'] = [user('u1', 'go')]
  await mount(waiting(null, { status: 'idle' }), ['cap-1'])
  await act(async () => conversation('cap-1').querySelector<HTMLButtonElement>('[data-fake-composer]')!.click())
  await act(settle)
  expect(typed).toEqual([CLEAR_LINE, BACKSPACE, promptBytes('ship it') + ENTER].map((k) => `7 ${JSON.stringify(k)}`))
})
