import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'

/** What the Tauri side answers: a branch for the header, GitHub issues for the `mnemo` repo. */
const gh: { auth: unknown; issues: unknown } = { auth: {}, issues: [] }
/** Every `job_run` the cockpit asked for, and what `job.rs` would emit back. */
const jobs = vi.hoisted(() => ({ runs: [] as { id: string; cwd: string; argv: string[] }[], on: {} as Record<string, (e: { payload: unknown }) => void>, refuse: null as string | null }))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string, args?: { root?: string }) => {
    if (cmd === 'job_run') {
      if (jobs.refuse) throw jobs.refuse
      return void jobs.runs.push(args as never)
    }
    return cmd === 'chrome_branch' ? 'main' : cmd === 'gh_auth' ? gh.auth : cmd === 'gh_issues' ? (args?.root === '/Users/me/github/mnemo' ? gh.issues : []) : {}
  }),
}))
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (name: string, h: (e: { payload: unknown }) => void) => {
    jobs.on[name] = h
    return () => {}
  },
}))
const emit = (name: 'job-line' | 'job-exit', payload: unknown) => act(() => jobs.on[name]({ payload }))

const answered = vi.hoisted(() => [] as [string, string][])
vi.mock('./approve', async (orig) => ({
  ...(await orig<typeof import('./approve')>()),
  answerPrompt: vi.fn(async (c: { id: string }, choice: string) => void answered.push([c.id, choice])),
}))

import { missionStore } from '../mission/app-store'
import { answerStore } from './approve'
import { store as appStore } from '../layout/app-store'
import { settingsStore } from '../settings/app-store'
import { paneView } from '../panes/registry'
import { all } from '../actions/registry'
import { issuePrs, merged, withPrs, shipped } from './fixtures'
import { cockpitStore } from './app-store'
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
  missionStore.setState({ snapshot: withPrs, lastError: null, looked: {}, drafts: {}, sent: {}, folds: {} })
  settingsStore.setState({ issueLabels: {} })
  gh.auth = {}
  gh.issues = []
  githubStore.setState({ auth: null, issues: {}, boards: {} })
  typed = []
  jobs.runs = []
  jobs.refuse = null
  cockpitStore.setState({ drawer: null, jobs: {} })
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
  act(() => button(blocked, 'take over')!.click())
  expect(opened('terminal-cmd')).toContainEqual({ cmd: 'claude attach 094c6a03' })
  act(() => button(blocked, 'stop')!.click())
  expect(opened('terminal-cmd')).not.toContainEqual({ cmd: 'claude stop 094c6a03' })
  act(() => button(blocked, 'really stop?')!.click())
  expect(opened('terminal-cmd')).toContainEqual({ cmd: 'claude stop 094c6a03' })

  act(() => button(rows()[1], 'open job')!.click())
  expect(opened('browser')).toContainEqual({ url: 'https://github.com/me/mnemo/pull/13/checks' })
})

/** Lets `runJob` get past its awaits (listen, then invoke). */
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))
const pill = (el: Element) => el.querySelector('.nd-word')?.textContent
const drawer = () => host.querySelector<HTMLElement>('.ck-drawer')

test('land and merge run headless only after a second press: no tab, no pane, the row says how it went', async () => {
  const m = desktop.missions[0]
  const ready = { ...desktop, missions: [{ ...m, pieces: [{ ...m.pieces[0], pr: { number: 7, url: 'https://github.com/me/d/pull/7', state: 'OPEN', head: 'feat/round3/cockpit', ci: 'pass' as const } }] }] }
  missionStore.setState({ snapshot: { ...withPrs, repos: [ready, shipped] } })
  await render()
  const landKey = `land:${shipped.missions[0].contract_path}`
  const land = () => row(landKey)
  act(() => button(land(), 'land')!.click())
  expect(jobs.runs).toEqual([])
  expect(button(land(), 'confirm land?')).toBeDefined()
  act(() => button(land(), 'confirm land?')!.click())
  await settle()
  // A list, never a shell string, keyed by the row that ran it.
  expect(jobs.runs).toEqual([{ id: landKey, cwd: shipped.root, argv: ['mnemo', 'land', shipped.missions[0].contract_path, '--merge'] }])
  expect(typed).toEqual([])
  expect(appStore.getState().tabs).toEqual([])
  expect(pill(land())).toBe('landing…')
  // Nothing to confirm while it runs.
  expect(button(land(), 'land')).toBeUndefined()

  emit('job-line', { id: landKey, stream: 'out', line: 'merging 3 PRs' })
  emit('job-line', { id: landKey, stream: 'err', line: 'remote: ok' })
  emit('job-exit', { id: landKey, code: 0 })
  expect(pill(land())).toBe('landed ✓')
  // Success is silence: the log is there for whoever asks, the drawer does not open.
  expect(drawer()).toBeNull()
  act(() => button(land(), 'log')!.click())
  expect(drawer()!.getAttribute('aria-label')).toBe('land · round4')
  expect([...drawer()!.querySelectorAll('.ck-log-line')].map((l) => l.textContent)).toEqual(['outmerging 3 PRs', 'errremote: ok'])
  expect(drawer()!.querySelector('.ck-log-end')?.textContent).toBe('exit 0')
  // The row it came from stays visible and clickable beside it.
  expect(land().isConnected).toBe(true)
  act(() => button(land(), 'log')!.click())
  expect(drawer()).toBeNull()

  const mergeKey = `ready:${desktop.root}#7`
  const merge = () => row(mergeKey)
  expect(merge().querySelector('.ck-label')?.textContent).toBe('cockpit · PR #7')
  act(() => button(merge(), 'merge')!.click())
  act(() => button(merge(), 'confirm merge?')!.click())
  await settle()
  // It reads the PR's checks first, as gh has them now, not as the row last saw them.
  expect(jobs.runs.at(-1)).toEqual({ id: `${mergeKey}:read`, cwd: desktop.root, argv: ['gh', 'pr', 'view', '7', '--json', 'number,state,isDraft,headRefOid,statusCheckRollup'] })
  expect(pill(merge())).toBe('merging…')
  const read = { number: 7, state: 'OPEN', isDraft: false, headRefOid: 'abc1234def', statusCheckRollup: [{ name: 'test (windows-latest)', conclusion: 'SUCCESS' }] }
  emit('job-line', { id: `${mergeKey}:read`, stream: 'out', line: JSON.stringify(read) })
  emit('job-exit', { id: `${mergeKey}:read`, code: 0 })
  await settle()
  expect(jobs.runs.at(-1)).toEqual({ id: `${mergeKey}:merge`, cwd: desktop.root, argv: ['gh', 'pr', 'merge', '7', '--squash', '--match-head-commit', 'abc1234def'] })
  expect(pill(merge())).toBe('merging…')
  emit('job-line', { id: `${mergeKey}:merge`, stream: 'err', line: 'X Pull request #7 is not mergeable: the base branch policy prohibits the merge.' })
  emit('job-exit', { id: `${mergeKey}:merge`, code: 1 })
  await settle()
  expect(pill(merge())).toBe('failed ✗')
  // gh's reason is on the row itself, where its detail was.
  expect(merge().querySelector('.ck-reason')?.textContent).toBe('not merged: Pull request #7 is not mergeable: the base branch policy prohibits the merge.')
  // A failure opens its drawer by itself, with what the gate read and what gh printed.
  expect(drawer()!.getAttribute('aria-label')).toBe('merge · PR #7')
  expect(drawer()!.querySelector('.ck-log-app')?.textContent).toBe('appPR #7 at abc1234: 1 check passed')
  expect(drawer()!.querySelector('.ck-log-err')?.textContent).toBe('errX Pull request #7 is not mergeable: the base branch policy prohibits the merge.')
  expect(drawer()!.querySelector('.ck-log-end')?.textContent).toBe('exit 1')
  // And it can be tried again, still asking twice.
  expect(button(merge(), 'merge')).toBeDefined()
  expect(typed).toEqual([])
})

test("a PR a child opened by issue is a row: red names its job, a green draft says draft, the merge says what it runs", async () => {
  missionStore.setState({ snapshot: { ...withPrs, repos: [issuePrs] } })
  await render()
  const root = issuePrs.root
  expect(rows().map((r) => r.dataset.key)).toEqual([`ci:${root}#50`, `ready:${root}#49`, `ready:${root}#51`, `ready:${root}#47`])
  const [red, draft, green] = [row(`ci:${root}#50`), row(`ready:${root}#49`), row(`ready:${root}#51`)]
  expect(red.querySelector('.ck-label')?.textContent).toBe('#40 · PR #50')
  expect(red.querySelector('.ck-detail')?.textContent).toBe('test (windows-latest) ✗')
  expect(pill(draft)).toBe('draft')
  expect(draft.querySelector('.ck-detail')?.textContent).toBe('draft · CI ✓ · open')
  expect(button(draft, 'merge')!.title).toBe('reads every check of PR #49, then gh pr ready 49 && gh pr merge 49 --squash --match-head-commit <the head it read>')
  expect(pill(green)).toBe('ready')
  expect(button(green, 'merge')!.title).toBe('reads every check of PR #51, then gh pr merge 51 --squash --match-head-commit <the head it read>')
  // No contract, so no map to open.
  expect(green.querySelector('.ck-mission')).toBeNull()
})

test('a job that cannot start fails in its row, and its log says why', async () => {
  jobs.refuse = 'mnemo not found in PATH'
  await render()
  const id = `land:${shipped.missions[0].contract_path}`
  act(() => button(row(id), 'land')!.click())
  act(() => button(row(id), 'confirm land?')!.click())
  await settle()
  expect(pill(row(id))).toBe('failed ✗')
  expect(drawer()!.querySelector('.ck-log-error')?.textContent).toBe('mnemo not found in PATH')
})

test('the log outlives its drawer, keeps streaming, and promotes to a pane without running again', async () => {
  await render()
  const id = `land:${shipped.missions[0].contract_path}`
  act(() => button(row(id), 'land')!.click())
  act(() => button(row(id), 'confirm land?')!.click())
  await settle()
  emit('job-line', { id, stream: 'out', line: 'one' })
  act(() => button(row(id), 'log')!.click())
  // Escape closes the window, never the job behind it.
  act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
  expect(drawer()).toBeNull()
  emit('job-line', { id, stream: 'out', line: 'two' })
  expect(pill(row(id))).toBe('landing…')
  act(() => button(row(id), 'log')!.click())
  expect([...drawer()!.querySelectorAll('.ck-log-text')].map((l) => l.textContent)).toEqual(['one', 'two'])
  // Enter on a row whose job runs shows the log, it does not arm a second run.
  act(() => cockpitStore.getState().closeDrawer())
  const sel = rows().findIndex((r) => r.dataset.key === id)
  for (let i = 0; i < sel; i++) key('ArrowDown')
  key('Enter')
  key('Enter')
  expect(jobs.runs).toHaveLength(1)
  expect(cockpitStore.getState().drawer).toBe(id)

  act(() => button(drawer()!, 'open in pane')!.click())
  expect(drawer()).toBeNull()
  expect(opened('job-log')).toEqual([{ job: id }])
  expect(jobs.runs).toHaveLength(1)
  const Pane = paneView('job-log')!
  const pane = document.createElement('div')
  const r2 = createRoot(pane)
  await act(async () => r2.render(<Pane id={-2} props={{ job: id }} />))
  emit('job-line', { id, stream: 'out', line: 'three' })
  expect([...pane.querySelectorAll('.ck-log-text')].map((l) => l.textContent)).toEqual(['one', 'two', 'three'])
  act(() => r2.unmount())
})

test('working and done today are collapsed below the needs and open on click', async () => {
  missionStore.setState({ snapshot: { ...withPrs, repos: withPrs.repos.map((r) => (r.root === shipped.root ? { ...r, children: r.children.map((c) => ({ ...c, branch: 'fix/issue-40' })) } : r)) } })
  await render()
  const [working, done] = [...host.querySelectorAll<HTMLButtonElement>('.ck-fold')]
  expect(working.textContent).toBe('▸ working: 2')
  expect(done.textContent).toBe('▸ done today: 1')
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
  await settle()
  expect(jobs.runs.map((r) => r.argv)).toEqual([['mnemo', 'land', shipped.missions[0].contract_path, '--merge']])
  act(() => button(card('pr:/Users/me/github/mnemo#13')!, 'open job')!.click())
  expect(opened('browser')).toContainEqual({ url: 'https://github.com/me/mnemo/pull/13/checks' })

  key('Escape')
  expect(host.querySelector('.ck-map')).toBeNull()
})

test('a blocked card on the map opens its reply under the canvas', async () => {
  await render()
  await act(async () => button(rows()[0], '⤢ round3')!.click())
  const vault = [...host.querySelectorAll<HTMLElement>('.ck-map .react-flow__node')].find((n) => n.dataset.id === `piece:${desktop.missions[0].contract_path}#vault`)!
  expect(vault.querySelector('.av-blocked-state')).not.toBeNull()
  act(() => button(vault, 'reply')!.click())
  expect(host.querySelector<HTMLTextAreaElement>('.mm-reply textarea')?.value).toBe('yes')
})

test('every child card on the map wears its state as a scene', async () => {
  await render()
  await act(async () => button(rows()[0], '⤢ round3')!.click())
  const map = host.querySelector('.ck-map')!
  expect(map.querySelector('.av-blocked-state'), 'a blocked child waves').not.toBeNull()
  expect(map.querySelector('.av-active, .av-done, .av-stalled, .av-stopped'), 'the others carry theirs too').not.toBeNull()
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
  expect(host.querySelector('.ck-fold')?.textContent).toBe('▸ working: 2')
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
  expect(host.querySelector('.ck-empty')?.textContent).toBe('nothing pending')
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

test('shows errors, and nothing pending when there is nothing at all', async () => {
  missionStore.setState({ snapshot: { repos: [], errors: ['gh missing on PATH'], at: '' }, lastError: null })
  await render()
  expect(host.textContent).toContain('gh missing on PATH')
  expect(host.querySelector('.ck-empty')?.textContent).toBe('nothing pending')
  expect(host.querySelector('.ck-fold')).toBeNull()
})

test('a permission row: Approve / Deny instead of the reply, y / n on the selected row, step back once an answer opened its attach', async () => {
  answered.length = 0
  const m = desktop.missions[0]
  const vault = m.pieces[1]
  const asking = { ...vault.child!, needs: 'approve Bash: touch approve-probe.txt && ls -la', suggested_reply: null, waiting_for: 'permission prompt' }
  missionStore.setState({ snapshot: { ...withPrs, repos: [{ ...desktop, missions: [{ ...m, pieces: [m.pieces[0], { ...vault, child: asking }] }] }, ...withPrs.repos.slice(1)] } })
  await render()
  const blocked = row('blocked:094c6a03')
  expect(blocked.querySelector('textarea')).toBeNull()
  expect(blocked.querySelector('.m-perm-cmd')?.textContent).toBe('touch approve-probe.txt && ls -la')
  // The cockpit row has its own take-over button; the box adds none.
  expect([...blocked.querySelectorAll('button')].filter((b) => b.textContent === 'take over')).toHaveLength(1)
  expect(host.querySelector('.ck-hint')?.textContent).toContain('y approve · n deny')

  key('y')
  key('n')
  key('r')
  expect(answered).toEqual([['094c6a03', 'yes'], ['094c6a03', 'no']])
  key('ArrowDown')
  key('y')
  expect(answered).toHaveLength(2)
  expect(host.querySelector('.ck-hint')?.textContent).toContain('r reply')

  // An answer left its attach pane open here: the row offers to step back from it.
  act(() => {
    appStore.setState({ tabs: [{ id: 'tab-8', root: { kind: 'leaf', pane: 8 }, focused: 8 }], panes: { 8: { id: 8, view: 'terminal', cwd: '/x' } } })
    answerStore.setState({ answers: { '094c6a03': { choice: 'yes', phase: 'sent', pane: 8, at: Date.now() } } })
  })
  expect(button(row('blocked:094c6a03'), 'step back')).toBeDefined()
  expect(button(row('blocked:094c6a03'), 'take over')).toBeUndefined()
  expect(row('blocked:094c6a03').querySelector('.m-sent')?.textContent).toContain('approved ✓')
})
