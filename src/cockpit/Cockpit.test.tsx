import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'

/** What the Tauri side answers: a branch for the header, GitHub issues for the `mnemo` repo. */
const gh: { auth: unknown; issues: unknown } = { auth: {}, issues: [] }
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string, args?: { root?: string }) =>
    cmd === 'chrome_branch' ? 'main' : cmd === 'gh_auth' ? gh.auth : cmd === 'gh_issues' ? (args?.root === '/Users/me/github/mnemo' ? gh.issues : []) : {},
  ),
}))

import { missionStore } from '../mission/app-store'
import { store as appStore } from '../layout/app-store'
import { settingsStore } from '../settings/app-store'
import { paneView } from '../panes/registry'
import { all } from '../actions/registry'
import { merged, withPrs, shipped } from './fixtures'
import { githubStore } from '../github/app-store'
import { mnemoIssues } from '../github/fixtures'
import { desktop, snapshot } from '../mission/fixtures'
import './view'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// React Flow measures with ResizeObserver, which jsdom lacks.
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = RO

let host: HTMLDivElement
let root: Root
let typed: [string | undefined, string][]

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  missionStore.setState({ snapshot: withPrs, lastError: null, looked: {}, drafts: {}, sent: {} })
  settingsStore.setState({ issueLabels: {} })
  gh.auth = {}
  gh.issues = []
  githubStore.setState({ auth: null, issues: {}, boards: {} })
  typed = []
  // Fresh panes per test, so what a test opened is what it sees.
  appStore.setState({ tabs: [], activeTab: '', panes: {}, openCommandTab: async (cwd, cmd) => void typed.push([cwd, cmd]) })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function render() {
  const View = paneView('cockpit')!
  await act(async () => root.render(<View id={-1} props={{}} />))
}

const rows = (sel = '.ck-needs .ck-row') => [...host.querySelectorAll<HTMLElement>(sel)]
const row = (key: string) => rows('.ck-row').find((r) => r.dataset.key === key)!
const button = (el: ParentNode, text: string) => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text)
const opened = (view: string) => Object.values(appStore.getState().panes).filter((p) => p.view === view).map((p) => p.props)
const key = (k: string, target: Element = host.querySelector('.cockpit')!) =>
  act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })))

test('registers the cockpit view and the cockpit.open action on ⌘⇧B', () => {
  expect(paneView('cockpit')).toBeDefined()
  expect(all().find((a) => a.id === 'cockpit.open')?.shortcut).toBe('⌘⇧B')
})

test('the inbox lists what needs you by urgency, with the reply inline and the row actions', async () => {
  await render()
  expect(host.querySelector('.ck-where')?.textContent).toBe('3 repos')
  expect(rows().map((r) => r.dataset.key)).toEqual(['blocked:094c6a03', 'ci:/Users/me/github/mnemo#13', `land:${shipped.missions[0].contract_path}`])
  expect(rows().map((r) => r.querySelector('.ck-label')?.textContent)).toEqual(['vault', 'docs · PR #13', 'round4'])
  // Every repo is listed, so each row names its own.
  expect(rows().map((r) => r.querySelector('.nd-repo')?.textContent)).toEqual(['mnemo-desktop', 'mnemo', 'mnemo'])

  const blocked = rows()[0]
  expect(blocked.querySelector('.m-needs')?.textContent).toBe('may I add a crate?')
  expect(blocked.querySelector('textarea')?.value).toBe('yes')
  act(() => button(blocked, 'attach')!.click())
  expect(opened('terminal-cmd')).toContainEqual({ cmd: 'claude attach 094c6a03' })
  act(() => button(blocked, 'stop')!.click())
  expect(opened('terminal-cmd')).not.toContainEqual({ cmd: 'claude stop 094c6a03' })
  act(() => button(blocked, 'really stop?')!.click())
  expect(opened('terminal-cmd')).toContainEqual({ cmd: 'claude stop 094c6a03' })

  act(() => button(rows()[1], 'abrir job')!.click())
  expect(opened('browser')).toContainEqual({ url: 'https://github.com/me/mnemo/pull/13/checks' })
})

test('land and merge run in a terminal tab only after a second press', async () => {
  const m = desktop.missions[0]
  const ready = { ...desktop, missions: [{ ...m, pieces: [{ ...m.pieces[0], pr: { number: 7, url: 'https://github.com/me/d/pull/7', state: 'OPEN', head: 'feat/round3/cockpit', ci: 'pass' as const } }] }] }
  missionStore.setState({ snapshot: { ...withPrs, repos: [ready, shipped] } })
  await render()
  const land = row(`land:${shipped.missions[0].contract_path}`)
  act(() => button(land, 'land')!.click())
  expect(typed).toEqual([])
  expect(button(land, 'confirm land?')).toBeDefined()
  act(() => button(land, 'confirm land?')!.click())
  expect(typed).toEqual([[shipped.root, `mnemo land ${shipped.missions[0].contract_path} --merge`]])

  const merge = row(`ready:${desktop.root}#7`)
  expect(merge.querySelector('.ck-label')?.textContent).toBe('cockpit · PR #7')
  act(() => button(merge, 'merge')!.click())
  act(() => button(merge, 'confirm merge?')!.click())
  expect(typed.at(-1)).toEqual([desktop.root, 'gh pr merge 7 --squash'])
})

test('andando and feito hoje are collapsed below the needs and open on click', async () => {
  missionStore.setState({ snapshot: { ...withPrs, repos: withPrs.repos.map((r) => (r.root === shipped.root ? { ...r, children: r.children.map((c) => ({ ...c, branch: 'fix/issue-40' })) } : r)) } })
  await render()
  const [working, done] = [...host.querySelectorAll<HTMLButtonElement>('.ck-fold')]
  expect(working.textContent).toBe('▸ andando: 2')
  expect(done.textContent).toBe('▸ feito hoje: 1')
  expect(rows('.ck-working')).toEqual([])
  act(() => working.click())
  expect(rows('.ck-working').map((r) => r.querySelector('.ck-label')?.textContent)).toEqual(['cockpit', '#40'])
  expect(rows('.ck-working')[0].querySelector('.ck-detail')?.textContent).toBe('writing the cockpit pane')
  expect(rows('.ck-working')[0].querySelector('.ck-tokens')?.textContent).toBe('320k')
  act(() => done.click())
  expect(rows('.ck-done').map((r) => r.querySelector('.ck-label')?.textContent)).toEqual(['api'])
  act(() => (rows('.ck-done')[0].querySelector('.ck-row-head') as HTMLElement).click())
  expect(opened('mission')).toContainEqual({ id: 'beef0001' })
})

test('keyboard: ↑↓ move the selection, Enter runs the row action, r focuses the reply, a attaches, typing is left alone', async () => {
  await render()
  const pane = host.querySelector<HTMLElement>('.cockpit')!
  expect(rows()[0].className).toContain('sel')
  key('ArrowDown')
  expect(rows()[1].className).toContain('sel')
  expect(opened('browser')).toEqual([])
  key('Enter')
  expect(opened('browser')).toEqual([{ url: 'https://github.com/me/mnemo/pull/13/checks' }])
  key('ArrowDown')
  key('ArrowDown')
  expect(rows()[2].className).toContain('sel')
  key('Enter')
  expect(typed).toEqual([])
  expect(button(rows()[2], 'confirm land?')).toBeDefined()

  key('ArrowUp')
  key('ArrowUp')
  key('r')
  const box = rows()[0].querySelector('textarea')!
  expect(document.activeElement).toBe(box)
  // Typed into the reply: not a list key.
  key('a', box)
  expect(opened('terminal-cmd')).toEqual([])
  pane.focus()
  key('a')
  expect(opened('terminal-cmd')).toEqual([{ cmd: 'claude attach 094c6a03' }])
})

test('a row\'s mission opens as a map beside the inbox, at 100%, with action cards; Esc closes it', async () => {
  gh.auth = { installed: true, logged: true, login: 'me', scopes: [] }
  gh.issues = mnemoIssues
  await render()
  await act(async () => button(rows()[1], '⤢ round4')!.click())
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
  const map = host.querySelector('.ck-map')!
  expect(map.querySelector('.mm-head')?.textContent).toContain('mission round4')
  const card = (id: string) => [...map.querySelectorAll<HTMLElement>('.react-flow__node')].find((n) => n.dataset.id === id)
  expect(card(`piece:${shipped.missions[0].contract_path}#docs`)).toBeDefined()
  expect(card('issue:/Users/me/github/mnemo#41')?.textContent).toContain('#41 contract api piece')
  expect(map.querySelector<HTMLElement>('.react-flow__viewport')?.style.transform).toContain('scale(1)')

  const land = card(`land:${shipped.missions[0].contract_path}`)!
  act(() => button(land, 'land')!.click())
  act(() => button(land, 'confirm land?')!.click())
  expect(typed).toEqual([[shipped.root, `mnemo land ${shipped.missions[0].contract_path} --merge`]])
  act(() => button(card('pr:/Users/me/github/mnemo#13')!, 'abrir job')!.click())
  expect(opened('browser')).toContainEqual({ url: 'https://github.com/me/mnemo/pull/13/checks' })

  key('Escape')
  expect(host.querySelector('.ck-map')).toBeNull()
})

test('a blocked card on the map opens its reply under the canvas', async () => {
  await render()
  await act(async () => button(rows()[0], '⤢ round3')!.click())
  const vault = [...host.querySelectorAll<HTMLElement>('.ck-map .react-flow__node')].find((n) => n.dataset.id === `piece:${desktop.missions[0].contract_path}#vault`)!
  expect(vault.querySelector('.gr-pulse')).not.toBeNull()
  act(() => button(vault, 'reply')!.click())
  expect(host.querySelector<HTMLTextAreaElement>('.mm-reply textarea')?.value).toBe('yes')
})

test('every repo is listed, the focused one first, and the head names it with its branch', async () => {
  await act(async () => {
    await appStore.getState().newTab()
  })
  const tab = appStore.getState().tabs.at(-1)!
  act(() => appStore.getState().setCwd(tab.focused, '/Users/me/github/mnemo-issue-40'))
  missionStore.setState({ snapshot })
  await render()
  expect(host.querySelector('.ck-where')?.textContent).toBe('mnemo · main · 3 repos')
  // No scope toggle any more: what needs you elsewhere is still here.
  expect(host.querySelector('.m-scope')).toBeNull()
  expect(rows().map((r) => r.dataset.key)).toEqual(['blocked:094c6a03'])
  expect(host.querySelector('.ck-fold')?.textContent).toBe('▸ andando: 2')
  act(() => host.querySelector<HTMLButtonElement>('.ck-fold')!.click())
  expect(rows('.ck-working').map((r) => [r.querySelector('.ck-label')?.textContent, r.querySelector('.nd-repo')?.textContent])).toEqual([
    ['#40', 'mnemo'],
    ['cockpit', 'mnemo-desktop'],
  ])
})

test('opened in a tab of its own, the repo you just left comes first', async () => {
  await act(async () => {
    await appStore.getState().newTab()
  })
  const tab = appStore.getState().tabs.at(-1)!
  act(() => appStore.getState().setCwd(tab.focused, '/Users/me/github/mnemo'))
  act(() => appStore.getState().openView('cockpit', {}, 'tab', 'cockpit'))
  expect(appStore.getState().activeTab).not.toBe(tab.id)
  missionStore.setState({ snapshot: withPrs })
  await render()
  expect(host.querySelector('.ck-where')?.textContent).toBe('mnemo · main · 3 repos')
  expect(rows().map((r) => r.dataset.key)).toEqual(['ci:/Users/me/github/mnemo#13', `land:${shipped.missions[0].contract_path}`, 'blocked:094c6a03'])
})

test('a row whose session runs in a tab of this window jumps to that tab, by session id or else by cwd', async () => {
  const leaf = (pane: number) => ({ kind: 'leaf' as const, pane })
  const worktree = '/Users/me/github/mnemo-desktop-wt-c-vault'
  appStore.setState({
    tabs: [{ id: 'tab-5', root: leaf(5), focused: 5 }, { id: 'tab-6', root: leaf(6), focused: 6 }],
    activeTab: '',
    panes: { 5: { id: 5, view: 'terminal', cwd: '/elsewhere' }, 6: { id: 6, view: 'terminal', cwd: `${worktree}/` } },
  })
  await render()
  const blocked = row('blocked:094c6a03')
  expect(blocked.className).toContain('ck-here')
  expect(blocked.querySelector('.ck-tab-link')?.textContent).toBe('↗ tab')
  act(() => (blocked.querySelector('.ck-label') as HTMLElement).click())
  expect(appStore.getState().activeTab).toBe('tab-6')
  expect(opened('mission')).toEqual([])

  // A pane tagged with the child's session wins over the cwd.
  const m = desktop.missions[0]
  const tagged = { ...desktop, missions: [{ ...m, pieces: [m.pieces[0], { ...m.pieces[1], child: { ...m.pieces[1].child!, session_id: 'sess-vault' } }] }] }
  missionStore.setState({ snapshot: { ...withPrs, repos: [tagged, ...withPrs.repos.slice(1)] } })
  act(() => appStore.getState().setSessionId(5, 'sess-vault'))
  act(() => appStore.setState({ activeTab: '' }))
  host.querySelector<HTMLElement>('.cockpit')!.focus()
  key('Enter')
  expect(appStore.getState().activeTab).toBe('tab-5')

  // Not open here: the row opens its mission pane as before.
  expect(row('ci:/Users/me/github/mnemo#13').className).not.toContain('ck-here')
})

test('a merged PR with a red last rollup is not a row', async () => {
  missionStore.setState({ snapshot: { ...withPrs, repos: [merged] } })
  await render()
  expect(rows()).toEqual([])
  expect(host.querySelector('.ck-empty')?.textContent).toBe('nada pendente')
})

test('the open map asks for the width its layout spans and the inbox narrows to titles', async () => {
  await render()
  expect(host.querySelector('.ck-body')?.className).not.toContain('ck-mapped')
  await act(async () => button(rows()[1], '⤢ round4')!.click())
  expect(host.querySelector('.ck-body')?.className).toContain('ck-mapped')
  expect(button(rows()[1], '⤢')?.title).toBe('Open the mission map of round4')
  // Contract, pieces, PRs, land: four 200px columns 48px apart, plus 16px either side.
  expect(host.querySelector<HTMLElement>('.ck-map .mm')?.style.getPropertyValue('--mm-w')).toBe(`${4 * 200 + 3 * 48 + 32}px`)
  key('Escape')
  expect(host.querySelector('.ck-body')?.className).not.toContain('ck-mapped')
})

test('shows errors, and nada pendente when there is nothing at all', async () => {
  missionStore.setState({ snapshot: { repos: [], errors: ['gh missing on PATH'], at: '' }, lastError: null })
  await render()
  expect(host.textContent).toContain('gh missing on PATH')
  expect(host.querySelector('.ck-empty')?.textContent).toBe('nada pendente')
  expect(host.querySelector('.ck-fold')).toBeNull()
})
