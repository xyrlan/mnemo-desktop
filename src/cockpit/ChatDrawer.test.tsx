import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'

const invoked = vi.hoisted(() => [] as [string, unknown][])
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string, args?: unknown) => {
    invoked.push([cmd, args])
    return cmd === 'chrome_branch' ? 'main' : {}
  }),
}))

import { missionStore } from '../mission/app-store'
import { store as appStore } from '../layout/app-store'
import { settingsStore } from '../settings/app-store'
import { paneView } from '../panes/registry'
import { cockpitStore } from './app-store'
import { PROMOTE } from './CardDrawer'
import { chatKey, chatTitle } from './ChatDrawer'
import InboxRow from './InboxRow'
import { child, desktop, snapshot } from '../mission/fixtures'
import type { ChildRow } from './inbox'
import type { Snapshot } from '../mission/types'
import './view'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// `a43d3832` (cockpit) works, `094c6a03` (vault) is blocked on a question; `c0ffee01` works in mnemo.
const WORKING = 'a43d3832'
const BLOCKED = '094c6a03'
const OTHER = 'c0ffee01'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  invoked.length = 0
  missionStore.setState({ snapshot, lastError: null, looked: {}, drafts: {}, sent: {}, replyErrors: {}, sending: {}, typing: {}, folds: { working: true, done: true } })
  settingsStore.setState({ outgoing: 'as-typed', replyLanguage: 'unchanged', issueLabels: {} })
  appStore.setState({ tabs: [], activeTab: '', panes: {}, openCommandTab: async () => {} })
  cockpitStore.setState({ drawer: null })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function render() {
  const View = paneView('cockpit')!
  await act(async () => root.render(<View id={-1} props={{}} />))
}

const row = (id: string) => [...host.querySelectorAll<HTMLElement>('.ck-inbox .ck-row')].find((r) => r.dataset.key?.endsWith(`:${id}`))!
const button = (el: ParentNode, text: string) => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text)
const drawers = () => [...host.querySelectorAll<HTMLElement>('.ck-drawer')]
const panes = () => Object.values(appStore.getState().panes).map((p) => [p.view, p.props])
const click = (b: HTMLElement | undefined) => act(async () => b!.click())
const type = (el: HTMLTextAreaElement, text: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, text)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })

test('every live child row has a chat button; a finished child and the sidebar have none', async () => {
  const done = child({ id: 'beef0009', state: 'done', live: false, updated_at: new Date().toISOString(), cwd: '/Users/me/github/mnemo-desktop-wt-x', branch: 'fix/issue-9' })
  const snap: Snapshot = { ...snapshot, repos: [{ ...desktop, children: [done] }, ...snapshot.repos.slice(1)] }
  missionStore.setState({ snapshot: snap })
  await render()
  for (const id of [WORKING, BLOCKED, OTHER]) expect(button(row(id), 'chat')).toBeDefined()
  expect(row('beef0009')).toBeDefined()
  expect(button(row('beef0009'), 'chat')).toBeUndefined()

  // The sidebar's rows have no board beside them for a drawer to slide into: no `onChat`, no button.
  const r: ChildRow = { kind: 'working', key: `working:${WORKING}`, repo: desktop, child: snapshot.repos[0].missions[0].pieces[0].child!, label: 'cockpit', mission: null }
  const side = document.createElement('div')
  document.body.append(side)
  const sideRoot = createRoot(side)
  await act(async () => sideRoot.render(<InboxRow row={r} selected={false} showRepo={false} narrow={false} armed={null} fire={() => true} onSelect={() => {}} />))
  expect(button(side, 'chat')).toBeUndefined()
  expect(button(side, 'take over')).toBeDefined()
  await act(async () => sideRoot.unmount())
  side.remove()
})

test('chat opens one drawer beside the list and no pane; another row swaps it, the same row closes it', async () => {
  await render()
  await click(button(row(WORKING), 'chat'))
  expect(cockpitStore.getState().drawer).toBe(chatKey(WORKING))
  expect(drawers()).toHaveLength(1)
  expect(drawers()[0].getAttribute('aria-label')).toBe('mnemo-desktop/cockpit')
  expect(drawers()[0].parentElement!.classList.contains('ck-body')).toBe(true)
  expect(host.querySelector('.ck-inbox .ck-row')).not.toBeNull()
  expect(button(row(WORKING), 'chat')!.classList.contains('ck-chatting')).toBe(true)
  expect(panes()).toEqual([])

  await click(button(row(OTHER), 'chat'))
  expect(drawers()).toHaveLength(1)
  expect(drawers()[0].getAttribute('aria-label')).toBe('mnemo/40')
  expect(button(row(WORKING), 'chat')!.classList.contains('ck-chatting')).toBe(false)

  await click(button(row(OTHER), 'chat'))
  expect(drawers()).toHaveLength(0)
  expect(panes()).toEqual([])
})

test('a message typed in the drawer goes to the child, shows in the history and opens nothing', async () => {
  await render()
  await click(button(row(WORKING), 'chat'))
  const drawer = drawers()[0]
  expect(drawer.textContent).toContain('writing the cockpit pane')
  expect(drawer.textContent).toContain('nothing sent to it yet')
  await type(drawer.querySelector('textarea')!, 'also bump the version')
  await click(button(drawer, 'send ⌘↩'))
  expect(invoked).toContainEqual(['mission_reply', { id: WORKING, text: 'also bump the version' }])
  expect([...drawer.querySelectorAll('.ck-chat-text')].map((e) => e.textContent)).toEqual(['also bump the version'])
  expect(drawer.querySelector('textarea')!.value).toBe('')
  expect(panes()).toEqual([])

  // Closing is a window shutting: the history is still there when it opens again.
  await act(async () => cockpitStore.getState().closeDrawer())
  expect(drawers()).toHaveLength(0)
  await click(button(row(WORKING), 'chat'))
  expect([...drawers()[0].querySelectorAll('.ck-chat-text')].map((e) => e.textContent)).toEqual(['also bump the version'])
})

test('a blocked child keeps its question on the card while the drawer is open', async () => {
  await render()
  await click(button(row(BLOCKED), 'chat'))
  // The question being waited for is answered where it is: on the card, not behind `chat`.
  const inline = row(BLOCKED).querySelector('.m-reply')!
  expect(inline.querySelector('.m-needs')!.textContent).toBe('may I add a crate?')
  expect(inline.querySelector('textarea')).not.toBeNull()
  // The drawer only sends; the question itself is not repeated in it.
  expect(drawers()[0].querySelector('.m-needs')).toBeNull()
  expect(drawers()[0].querySelector('textarea')).not.toBeNull()
})

test('a permission prompt stays inline too: Approve / Deny on the card, never in the drawer', async () => {
  const asks = child({ id: BLOCKED, cwd: '/Users/me/github/mnemo-desktop-wt-c-vault', tempo: 'blocked', needs: 'approve Bash: cargo add serde' })
  const repo = { ...desktop, missions: [{ ...desktop.missions[0], pieces: [desktop.missions[0].pieces[0], { ...desktop.missions[0].pieces[1], child: asks }] }] }
  missionStore.setState({ snapshot: { ...snapshot, repos: [repo, ...snapshot.repos.slice(1)] } })
  await render()
  await click(button(row(BLOCKED), 'chat'))
  expect(row(BLOCKED).querySelector('.m-permission')).not.toBeNull()
  expect(button(row(BLOCKED), 'Approve')).toBeDefined()
  expect(drawers()[0].querySelector('.m-permission')).toBeNull()
  expect(button(drawers()[0], 'Approve')).toBeUndefined()
})

test('"open in pane" is take over: it attaches to the real terminal and the drawer gets out of the way', async () => {
  await render()
  await click(button(row(WORKING), 'chat'))
  await click(button(drawers()[0], PROMOTE))
  expect(panes()).toEqual([['terminal-cmd', { cmd: `claude attach ${WORKING}` }]])
  expect(drawers()).toHaveLength(0)
  expect(cockpitStore.getState().drawer).toBeNull()
  // And `take over` on the row is exactly what it was.
  await click(button(row(WORKING), 'take over'))
  expect(panes()).toHaveLength(2)
})

test('a child that blocks, then finishes, mid-conversation keeps its drawer; a finished one has no input', async () => {
  await render()
  await click(button(row(WORKING), 'chat'))
  const piece = snapshot.repos[0].missions[0].pieces[0]
  const withChild = (c: typeof piece.child) => ({ ...snapshot, repos: [{ ...desktop, missions: [{ ...desktop.missions[0], pieces: [{ ...piece, child: c }, desktop.missions[0].pieces[1]] }] }, ...snapshot.repos.slice(1)] })

  // Blocked, it moved lists (its row key is now `blocked:…`): the drawer is keyed by the child.
  await act(async () => missionStore.setState({ snapshot: withChild({ ...piece.child!, tempo: 'blocked', needs: 'which port?' }) }))
  expect(row(WORKING).dataset.key).toBe(`blocked:${WORKING}`)
  expect(drawers()).toHaveLength(1)

  await act(async () => missionStore.setState({ snapshot: withChild({ ...piece.child!, state: 'done', live: false, updated_at: new Date().toISOString() }) }))
  expect(drawers()).toHaveLength(1)
  expect(drawers()[0].querySelector('textarea')).toBeNull()
  expect(drawers()[0].textContent).toContain('the child is done')
})

test('the title is the repo and what the row calls the child', () => {
  expect(chatTitle(desktop, '#103')).toBe('mnemo-desktop/103')
  expect(chatTitle(desktop, 'cockpit')).toBe('mnemo-desktop/cockpit')
})
