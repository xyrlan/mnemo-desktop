import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'

// A plain recorder, not vi.fn(): what the tab asked the core for.
const ipc = vi.hoisted(() => ({ calls: [] as [string, Record<string, unknown> | undefined][] }))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args?: Record<string, unknown>) => {
    ipc.calls.push([cmd, args])
    if (cmd === 'mission_timeline') return { lines: [], total: 0 }
    if (cmd === 'conversation_follow') return 1
    if (cmd === 'settings_read') return {}
    if (cmd === 'mission_snapshot') return { repos: [], errors: [], at: '' }
    if (cmd === 'home_snapshot') return { repos: [], clone_base: '', errors: [], protected: 0 }
    if (cmd === 'worktree_list') return []
    return null
  },
  Channel: class {
    onmessage = () => {}
  },
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))
// The detail's conversation, diff and checks are other pieces': the tab is tested on what it hands
// them, read back from these stand-ins.
const seen = vi.hoisted(() => ({ conversation: null as null | Record<string, unknown>, diff: null as null | Record<string, unknown>, checks: null as null | Record<string, unknown> }))
vi.mock('../conversation/ConversationView', () => ({
  ConversationView: (props: Record<string, unknown>) => {
    seen.conversation = props
    return <div className="conversation-stub" />
  },
}))
vi.mock('../diff/ChildDiff', () => ({
  ChildDiff: (props: Record<string, unknown>) => {
    seen.diff = props
    return <div className="diff-stub" />
  },
}))
vi.mock('../checks/ChecksPanel', () => ({
  ChecksPanel: (props: Record<string, unknown>) => {
    seen.checks = props
    return <div className="checks-stub" />
  },
}))
// The chat-input piece's cards, as stand-ins that say what they were given.
vi.mock('../chat-input/Composer', () => ({ ChatComposer: (p: { placeholder?: string }) => <div className="composer-stub">{p.placeholder}</div> }))
vi.mock('../chat-input/ApprovalCard', () => ({ ApprovalCard: (p: { tool: string; summary: string }) => <div className="approval-stub">{`${p.tool} | ${p.summary}`}</div> }))
vi.mock('../chat-input/QuestionCard', () => ({ QuestionCard: (p: { question: string }) => <div className="question-stub">{p.question}</div> }))

import { paneView } from '../panes/registry'
import { missionStore } from '../mission/app-store'
import { store as appStore } from '../layout/app-store'
import { EMPTY_LAYOUT } from '../layout/groups'
import { leaves } from '../layout/tree'
import { child, parent } from '../mission/fixtures'
import type { ChildSession, Mission, Pr, Snapshot } from '../mission/types'
import { uiStore } from './store'
import { ISSUES, openDispatch, parentWorktree, useWaveLines } from './index'
import { VIEW } from './open'
import './view'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ROOT = '/code/app'
const WT = '/code/app-wt-parent'
const kid = (id: string, over: Partial<ChildSession> = {}) =>
  child({ id, session_id: `${id}-session`, parent_session: 'p1', cwd: `/code/app-wt-${id}`, updated_at: new Date().toISOString(), detail: `${id} at work`, ...over })
const pr = (number: number, over: Partial<Pr> = {}): Pr => ({ number, url: `https://x/pull/${number}`, state: 'OPEN', head: '', ci: 'pass', ...over })
const mission = (feature: string, pieces: [string, ChildSession | null, Pr | null][], landable = false): Mission => ({
  feature,
  contract_path: `${ROOT}/docs/contracts/${feature}.md`,
  landable,
  pieces: pieces.map(([name, c, p]) => ({ name, branch: `feat/${feature}/${name}`, child: c, pr: p })),
})

const snapshot: Snapshot = {
  repos: [
    {
      root: ROOT,
      name: 'app',
      parents: [parent({ session_id: 'p1', cwd: WT }), parent({ session_id: 'p2', cwd: ROOT })],
      missions: [
        mission('old-wave', [['shipped', kid('s1', { state: 'done', live: false }), pr(10)]], true),
        mission('other-parent', [['theirs', kid('o1', { parent_session: 'p2' }), null]]),
        mission('new-wave', [
          ['done', kid('d1', { state: 'done', live: false }), pr(12, { ci: 'fail', failing: ['test (macos)'] })],
          ['work', kid('w1'), null],
          ['ask', kid('a1', { tempo: 'blocked', needs: 'approve Bash: pnpm test', waiting_for: 'permission prompt' }), null],
          ['question', kid('q1', { tempo: 'blocked', needs: 'May I add a crate?' }), null],
        ]),
      ],
      children: [kid('i1', { name: 'fix-login' })],
    },
  ],
  errors: [],
  at: '2026-09-25T12:00:00Z',
}

let host: HTMLDivElement
let root: Root

function layout(active: string) {
  const other = active === WT ? ROOT : WT
  appStore.setState({
    activeWorktree: active,
    worktrees: [ROOT, WT],
    parked: { [other]: active === WT ? EMPTY_LAYOUT : { ...EMPTY_LAYOUT } },
    tabs: [{ id: 'tab-1', root: { kind: 'leaf', pane: 1 }, focused: 1 }],
    activeTab: 'tab-1',
    groups: {},
    groupRoot: null,
    activeGroup: '',
    panes: { 1: { id: 1, view: 'terminal', cwd: active, sessionId: active === WT ? 'p1' : undefined } },
  })
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  ipc.calls = []
  seen.conversation = seen.diff = seen.checks = null
  uiStore.setState({ selected: {}, detail: {}, folds: {}, reveal: {} })
  missionStore.setState({ snapshot })
  layout(WT)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function mount(props: Record<string, unknown> = { parent: WT }) {
  const Pane = paneView(VIEW)!
  await act(async () => {
    root.render(<Pane id={-7} props={props} />)
  })
}
const sections = () => [...host.querySelectorAll<HTMLElement>('[data-wave]')].map((s) => s.dataset.wave)
const rowsOf = (wave: string) => [...host.querySelectorAll<HTMLElement>(`[data-wave="${wave}"] [data-row]`)].map((r) => r.dataset.row)
const row = (key: string) => host.querySelector<HTMLElement>(`[data-row="${key}"]`)!
const click = async (el: Element | null) => {
  await act(async () => void (el as HTMLElement).click())
}

test("draws the parent's waves newest first, then Issues, and nothing of another parent's", async () => {
  await mount()
  expect(sections()).toEqual(['new-wave', 'old-wave', ISSUES])
  expect(host.textContent).not.toContain('theirs')
  expect(rowsOf(ISSUES)).toEqual(['i1'])
})

test('puts the children that need you on top, each with its answer card open in its row', async () => {
  await mount()
  // The done row is folded while the wave has work open.
  expect(rowsOf('new-wave')).toEqual(['a1', 'q1', 'w1'])
  // A permission prompt the transcript has not written yet: the card answers from the snapshot.
  expect(row('a1').querySelector('[data-answer] .approval-stub')?.textContent).toBe('Bash | pnpm test')
  // A question asked as it ended its turn: the question, and the composer that answers it as you.
  expect(row('q1').querySelector('[data-answer]')?.textContent).toContain('May I add a crate?')
  expect(row('q1').querySelector('.composer-stub')?.textContent).toBe('Answer the child, as you…')
  expect(row('w1').querySelector('[data-answer]')).toBeNull()
  // What the answer card follows: the child's own transcript.
  expect(ipc.calls.filter(([c]) => c === 'conversation_follow').map(([, a]) => a?.sessionId)).toEqual(expect.arrayContaining(['a1-session', 'q1-session']))
})

test("folds a finished wave, and a wave's done rows while it has work open", async () => {
  await mount()
  expect(host.querySelector('[data-wave="old-wave"]')?.hasAttribute('data-folded')).toBe(true)
  expect(rowsOf('old-wave')).toEqual([])
  expect(host.querySelector('[data-wave="old-wave"] [data-landable]')).not.toBeNull()
  await click(host.querySelector('[data-wave="new-wave"] [data-done-fold]'))
  expect(rowsOf('new-wave')).toEqual(['a1', 'q1', 'w1', 'd1'])
  expect(row('d1').querySelector('[data-ci="fail"]')?.textContent).toContain('test (macos)')
  await click(host.querySelector('[data-wave="old-wave"] button[aria-expanded]'))
  expect(rowsOf('old-wave')).toEqual(['s1'])
})

test('titles its tab with the alert, and leaves a name the user gave it alone', async () => {
  appStore.getState().openView(VIEW, { parent: WT }, 'split-row')
  const { panes, tabs } = appStore.getState()
  const pane = Number(Object.keys(panes).find((id) => panes[Number(id)].view === VIEW))
  const tab = () => appStore.getState().tabs.find((t) => leaves(t.root).includes(pane))!
  expect(tabs).toHaveLength(2)
  const Pane = paneView(VIEW)!
  await act(async () => root.render(<Pane id={pane} props={{ parent: WT }} />))
  expect(tab().name).toBe('Dispatch · 2 need you')
  await act(async () => appStore.getState().renameTab(tab().id, 'waves'))
  await act(async () => missionStore.setState({ snapshot: { ...snapshot, at: 'later' } }))
  expect(tab().name).toBe('waves')
})

test('a click on a row shows the child on the right; its row then points there', async () => {
  await mount()
  expect(host.querySelector('[data-detail-empty]')).not.toBeNull()
  await click(row('a1').querySelector('button'))
  expect(host.querySelector('[data-detail]')?.getAttribute('data-detail')).toBe('a1')
  expect(seen.conversation).toMatchObject({ sessionId: 'a1-session', cwd: '/code/app-wt-a1' })
  // Its card is the conversation's foot now: not drawn twice.
  expect(row('a1').querySelector('[data-answer]')).toBeNull()
  expect(row('a1').textContent).toContain('Answer it in the conversation')
  expect(row('a1').textContent).toContain('Bash: pnpm test')
  expect(row('q1').querySelector('[data-answer]')).not.toBeNull()
})

test("Diff and Checks show the child's own worktree, and the row's card comes back off the conversation", async () => {
  await mount()
  await click(row('a1').querySelector('button'))
  await click(host.querySelector('[data-detail-tab="diff"]'))
  expect(seen.diff).toEqual({ worktree: '/code/app-wt-a1' })
  expect(row('a1').querySelector('[data-answer]')).not.toBeNull()
  await click(host.querySelector('[data-detail-tab="checks"]'))
  expect(seen.checks).toMatchObject({ worktree: '/code/app-wt-a1', destination: { kind: 'agent' } })
})

test("a send from a finished child's Checks starts nothing in its worktree", async () => {
  await mount()
  await click(host.querySelector('[data-wave="new-wave"] [data-done-fold]'))
  await click(row('d1').querySelector('button'))
  await click(host.querySelector('[data-detail-tab="checks"]'))
  expect(seen.checks?.destination).toEqual({ kind: 'none', reason: 'the child is not running: nothing reaches it' })
})

test('Stop asks before it types claude stop', async () => {
  await mount()
  await click(row('w1').querySelector('button'))
  const stop = host.querySelector('[data-stop]')!
  await click(stop)
  expect(stop.textContent).toContain('Really stop?')
})

describe('openDispatch', () => {
  it("shows the parent's workspace with the tab open, focused, beside its terminal, and the child selected", async () => {
    layout(ROOT)
    await act(async () => openDispatch(WT, 'w1'))
    const s = appStore.getState()
    expect(s.activeWorktree).toBe(WT)
    const t = s.tabs.find((x) => x.id === s.activeTab)!
    expect(s.panes[t.focused]).toMatchObject({ view: VIEW, props: { parent: WT } })
    expect(uiStore.getState().selected[WT]).toBe('w1')
    expect(uiStore.getState().reveal[WT]?.target).toBe('w1')
    // Once: a second click shows the same tab.
    await act(async () => openDispatch(`${WT}/`, 'a1'))
    expect(appStore.getState().tabs.filter((x) => appStore.getState().panes[x.focused].view === VIEW)).toHaveLength(1)
    expect(uiStore.getState().selected[WT]).toBe('a1')
  })

  it('opens on a wave, or on Issues, with nothing selected', async () => {
    await act(async () => openDispatch(WT, ISSUES))
    expect(uiStore.getState().selected[WT]).toBeUndefined()
    expect(uiStore.getState().reveal[WT]?.target).toBe(ISSUES)
    await mount()
    expect(host.querySelector(`[data-wave="${ISSUES}"]`)?.hasAttribute('data-folded')).toBe(false)
  })
})

test('parentWorktree is the worktree of the session that dispatched the child, else the main checkout', () => {
  expect(parentWorktree('w1')).toBe(WT)
  expect(parentWorktree('o1')).toBe(ROOT)
  expect(parentWorktree('nope')).toBeNull()
})

test('useWaveLines counts each section, and hands back the same array while no count changes', async () => {
  const got: ReturnType<typeof useWaveLines>[] = []
  function Probe({ p }: { p: string }) {
    got.push(useWaveLines(p))
    return null
  }
  await act(async () => root.render(<Probe p={WT} />))
  const first = got.at(-1)
  expect(first).toEqual([
    { feature: 'new-wave', needsYou: 2, working: 1, done: 1 },
    { feature: 'old-wave', needsYou: 0, working: 0, done: 1 },
    { feature: ISSUES, needsYou: 0, working: 1, done: 0 },
  ])
  // A poll that changes no count: a new object graph, the same lines.
  await act(async () => missionStore.setState({ snapshot: JSON.parse(JSON.stringify(snapshot)) }))
  expect(got.length).toBeGreaterThan(1)
  expect(got.at(-1)).toBe(first)
  await act(async () => root.render(<Probe p={ROOT} />))
  expect(got.at(-1)).toEqual([{ feature: 'other-parent', needsYou: 0, working: 1, done: 0 }])
})
