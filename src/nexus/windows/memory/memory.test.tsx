import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { MemoryFeed } from '../../../memory/types'
import type { Agent, Health, Page, RuleRow, RunResult, VaultGraph } from '../../../vault/types'

// Synthetic: the repos are this one and `mnemo`, the paths under a made-up home.
const t = vi.hoisted(() => ({
  calls: [] as [string, Record<string, unknown> | undefined][],
  /** What `vault_run` answers, by `mnemo` subcommand and first argument. */
  run: {} as Record<string, RunResult>,
  feed: null as unknown,
  fleet: {
    repos: [
      { root: '/Users/you/code/mnemo-desktop', name: 'mnemo-desktop', worktrees: [] },
      { root: '/Users/you/code/mnemo', name: 'mnemo', worktrees: [] },
    ],
  },
}))

const dir = '/Users/you/vault/bots/mnemo-desktop/memory'
const target = `${dir}/project/one-cargo-target.md`
const rule = (slug: string, over: Partial<RuleRow> = {}): RuleRow => ({
  path: `${dir}/project/${slug}.md`,
  slug,
  name: slug,
  description: `about ${slug}`,
  type: 'project',
  agent: 'mnemo-desktop',
  confidence: 'verified',
  topics: ['build'],
  fires: 3,
  last_fired: null,
  heat: 1.2,
  badges: [],
  reasons: [],
  ...over,
})
const RULES = [rule('one-cargo-target'), rule('fresh-target-needs-sdkroot', { confidence: 'observed', badges: ['review'], reasons: ['verified without evidence'] })]
const pageOf = (path: string): Page => ({
  path,
  slug: path.split('/').pop()!.replace(/\.md$/, ''),
  name: path.split('/').pop()!.replace(/\.md$/, ''),
  description: 'one shared target dir',
  type: 'project',
  confidence: 'verified',
  topics: ['build'],
  modified: Date.UTC(2026, 9, 1),
  body: '# Rule\n\nEvery worktree shares it. See [[fresh-target-needs-sdkroot]] and [the docs](https://example.com/docs).',
  runtime: null,
  frontmatter: [{ key: 'type', value: 'project' }],
  error: null,
})
const TREE: Agent[] = [
  { name: 'shared', kind: 'shared', dir: '/Users/you/vault/shared', groups: [{ type: 'reference', pages: [{ ...pageOf('/Users/you/vault/shared/reference/run-git-yourself.md') }] }] },
  {
    name: 'mnemo-desktop',
    kind: 'repo',
    dir,
    groups: [{ type: 'project', pages: [pageOf(target), pageOf(`${dir}/project/fresh-target-needs-sdkroot.md`)] }],
  },
  { name: 'bg-pytest-1', kind: 'other', dir: '/Users/you/vault/bots/bg-pytest-1/memory', groups: [{ type: 'user', pages: [{ ...pageOf('/Users/you/vault/bots/bg-pytest-1/memory/user/noise.md') }] }] },
]
const HEALTH: Health = {
  root: '/Users/you/vault',
  status: { stdout: 'vault: 3 pages', stderr: '', code: 0 },
  tiles: [{ key: 'pages', label: 'pages', value: '3', detail: '3 pages', tone: 'muted' }],
  label_only: [{ path: `${dir}/project/fresh-target-needs-sdkroot.md`, slug: 'fresh-target-needs-sdkroot', name: 'fresh-target-needs-sdkroot', reason: 'verified without evidence' }],
  dormant: [],
  pages: 3,
  never_fired: 0,
  inbox: 1,
  error: null,
}
const EGO: VaultGraph = {
  center: target,
  nodes: [
    { id: target, label: 'one-cargo-target', slug: 'one-cargo-target', type: 'project', confidence: 'verified', topics: ['build'], fires: 3, last_fired: null },
    { id: `${dir}/project/fresh-target-needs-sdkroot.md`, label: 'fresh-target-needs-sdkroot', slug: 'fresh-target-needs-sdkroot', type: 'project', confidence: 'observed', topics: ['build'], fires: 0, last_fired: null },
  ],
  edges: [
    { id: 'l', source: target, target: `${dir}/project/fresh-target-needs-sdkroot.md`, kind: 'link', label: '' },
    { id: 't', source: target, target: `${dir}/project/fresh-target-needs-sdkroot.md`, kind: 'topic', label: 'build' },
  ],
  total: 1,
  error: null,
}
const LISTING = `1 staged page for mnemo-desktop in shared/_inbox/ (median 2d, oldest 2d)

  reference/keep-the-suite-green   new   2d  Run the whole suite before a push

nothing was written — this is a listing only.
  (4 more staged for other projects — \`mnemo inbox --all\`)
`
const FEED: MemoryFeed = {
  project: 'mnemo-desktop',
  briefing: { sessionId: '00000000-0000-7000-8000-000000000001', date: '2026-10-14', tldr: 'Built the drawer.', path: '/Users/you/vault/bots/mnemo-desktop/briefings/sessions/b.md' },
  fired: [{ slug: 'one-cargo-target', name: 'one-cargo-target', at: Date.now() - 120_000, source: 'reflex' }],
  learned: [{ slug: 'fresh-target-needs-sdkroot', name: 'fresh-target-needs-sdkroot', at: Date.now() - 3_600_000 }],
  inbox: [{ key: 'reference/keep-the-suite-green', type: 'reference', title: 'keep-the-suite-green', excerpt: '' }],
}

vi.mock('@tauri-apps/api/core', () => ({
  Channel: class {},
  invoke: async (cmd: string, args?: Record<string, unknown>) => {
    t.calls.push([cmd, args])
    switch (cmd) {
      case 'vault_tree':
        return TREE
      case 'vault_page':
        return pageOf(args!.path as string)
      case 'vault_rules':
        return RULES
      case 'vault_health':
        return HEALTH
      case 'vault_ego':
        return EGO
      case 'memory_feed':
        if (t.feed === null) throw 'no vault for this project'
        return t.feed
      case 'vault_run': {
        const a = args!.args as string[]
        return t.run[`${args!.action} ${a[0] ?? ''}`.trim()] ?? t.run[args!.action as string] ?? { stdout: '', stderr: '', code: 0 }
      }
    }
    return null
  },
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))
// A stable object: a fresh array per call would loop the renders.
vi.mock('../../../fleet/store', () => ({ useFleet: <T,>(sel: (f: typeof t.fleet) => T): T => sel(t.fleet) }))

import { closeWindow, openWindow, windowStore, windowsIn } from '../../ui/windows'
import { WindowHost } from '../../ui/Window'
import { ConfirmHost } from '../../ui/confirm'
import { vault } from '../../../vault/app-store'
import { memoryTab } from './MemoryWindow'
import { repoChoice } from './repo'
import { relation } from './PageView'
import './index'
import '../learned/index'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
Element.prototype.scrollIntoView ??= () => {}

const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))
const click = async (el: Element | null | undefined) => {
  expect(el).toBeTruthy()
  await act(async () => void (el as HTMLElement).click())
  await flush()
}
const button = (text: string | RegExp, within: ParentNode = document) =>
  [...within.querySelectorAll('button')].find((b) => (typeof text === 'string' ? b.textContent === text : text.test(b.textContent ?? '')))
const key = (k: string, el: EventTarget = document) => act(async () => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })))
const ran = (action: string) => t.calls.filter(([c, a]) => c === 'vault_run' && a!.action === action).map(([, a]) => a!)
const answer = (text: string) => click(button(text, document.querySelector('[data-nx-confirm]')!))

let root: Root
beforeEach(async () => {
  t.calls.length = 0
  t.run = { stale: { stdout: '', stderr: '', code: 0 }, inbox: { stdout: LISTING, stderr: '', code: 0 } }
  t.feed = FEED
  repoChoice.setState({ root: null })
  memoryTab.setState({ tab: 'activity' })
  vault.setState({ selected: null, page: null, filter: '', query: '', log: [], inboxSelected: null, inboxNotice: null, inboxAll: false, health: null })
  const host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await act(async () =>
    root.render(
      <>
        <WindowHost />
        <ConfirmHost />
      </>,
    ),
  )
})
afterEach(async () => {
  await act(async () => closeWindow())
  await act(async () => root.unmount())
  document.body.innerHTML = ''
})

const open = async (id = 'memory') => {
  await act(async () => openWindow(id))
  await flush()
}
const tab = (name: string) => click([...document.querySelectorAll('[role=tab]')].find((b) => b.textContent === name))

test('Memory and What mnemo learned are the first two SYSTEMS windows, in that order', () => {
  const ids = windowsIn('systems').map((d) => d.id)
  expect(ids.slice(0, 2)).toEqual(['memory', 'learned'])
  expect(windowsIn('systems')[0].title).toBe('Memory')
})

test('activity reads the first repo the app knows: its briefing, what fired, what was learned, the inbox count', async () => {
  await open()
  expect(t.calls.find(([c]) => c === 'memory_feed')![1]).toEqual({ cwd: '/Users/you/code/mnemo-desktop', sessionId: null })
  const w = document.querySelector('[data-memory-window]')!
  expect(w.textContent).toContain('Built the drawer.')
  expect(w.textContent).toContain('injected by a hook')
  expect(w.textContent).toContain('2m')
  expect(w.textContent).toContain('fresh-target-needs-sdkroot')
  expect(w.textContent).toContain('1 staged page waits')
  // Read opens the briefing in full, in Pages.
  await click(button('Read', w))
  expect(memoryTab.getState().tab).toBe('pages')
  expect(t.calls.some(([c, a]) => c === 'vault_page' && a!.path === FEED.briefing!.path)).toBe(true)
})

test('picking another repo reads it, and a failed read says why', async () => {
  await open()
  t.feed = null
  const select = document.querySelector<HTMLSelectElement>('select[aria-label=Repo]')!
  await act(async () => {
    select.value = '/Users/you/code/mnemo'
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await flush()
  expect(repoChoice.getState().root).toBe('/Users/you/code/mnemo')
  expect(t.calls.filter(([c]) => c === 'memory_feed').at(-1)![1]!.cwd).toBe('/Users/you/code/mnemo')
  expect(document.querySelector('[role=alert]')!.textContent).toContain('no vault for this project')
})

test('health: the strip, rules by heat, a rule opened beside the table, Esc closes it before the window', async () => {
  await open()
  await tab('Health')
  expect(ran('stale')[0]).toMatchObject({ cwd: '/Users/you/code/mnemo-desktop', args: ['--json'] })
  const w = document.querySelector('[data-memory-window]')!
  expect(w.querySelector('[data-tile=review]')!.textContent).toContain('1needs review')
  expect([...w.querySelectorAll('[data-rule]')].map((r) => r.getAttribute('data-rule'))).toEqual(['one-cargo-target', 'fresh-target-needs-sdkroot'])
  // Only problems.
  await click(w.querySelector('[data-tile=review]'))
  expect([...w.querySelectorAll('[data-rule]')].map((r) => r.getAttribute('data-rule'))).toEqual(['fresh-target-needs-sdkroot'])
  vault.getState().setChips({ problems: false })
  await flush()

  await click(w.querySelector('[data-rule=one-cargo-target]'))
  const page = w.querySelector(`[data-page="${target}"]`)!
  expect(page.textContent).toContain('Every worktree shares it.')
  expect(page.querySelector('h2')!.textContent).toBe('Rule')
  // The neighbourhood is read only once asked for.
  expect(t.calls.some(([c]) => c === 'vault_ego')).toBe(false)
  await tab('Neighbours')
  expect(w.querySelector('[data-neighbour]')!.textContent).toContain('links to it · shares build')

  await key('Escape')
  expect(vault.getState().selected).toBeNull()
  expect(windowStore.getState().open?.id).toBe('memory')
  await key('Escape')
  expect(windowStore.getState().open).toBeNull()
})

test('a rule is disabled only once the confirmation says so, in the picked repo', async () => {
  await open()
  await tab('Health')
  const w = document.querySelector('[data-memory-window]')!
  const disable = () => button('Disable', w.querySelector('[data-rule=one-cargo-target]')!)
  await click(disable())
  expect(document.querySelector('[data-nx-confirm]')!.textContent).toContain('mnemo disable-rule one-cargo-target')
  await answer('Cancel')
  expect(ran('disable-rule')).toEqual([])
  await click(disable())
  await answer('Disable rule')
  expect(ran('disable-rule')).toEqual([{ action: 'disable-rule', args: ['one-cargo-target'], cwd: '/Users/you/code/mnemo-desktop' }])
  // The run shows under the window, and the window stays.
  expect(document.querySelector('[data-run=disable]')!.textContent).toContain('exit 0')
  expect(windowStore.getState().open?.id).toBe('memory')
})

test('pages: the tree by agent, searchable; a wikilink selects its page; a web link leaves for the browser', async () => {
  await open()
  await tab('Pages')
  const w = document.querySelector('[data-memory-window]')!
  // The repo's agent and shared open; the test-run agents fold under other.
  expect([...w.querySelectorAll('[data-agent]')].map((a) => a.getAttribute('data-agent'))).toEqual(['mnemo-desktop', 'shared'])
  expect(w.textContent).toContain('other1 agents')
  expect(w.textContent).not.toContain('noise')
  const search = w.querySelector<HTMLInputElement>('input[aria-label="Search pages"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'run-git')
    search.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect([...w.querySelectorAll('[data-agent]')].map((a) => a.getAttribute('data-agent'))).toEqual(['shared'])
  // Esc clears the search, and leaves the window open.
  await key('Escape', search)
  expect(vault.getState().query).toBe('')
  expect(windowStore.getState().open?.id).toBe('memory')

  await click(button(/^one-cargo-target/, w))
  await click([...w.querySelectorAll('.nx-md a')].find((a) => a.textContent === 'fresh-target-needs-sdkroot'))
  expect(vault.getState().selected).toBe(`${dir}/project/fresh-target-needs-sdkroot.md`)
  await click([...w.querySelectorAll('.nx-md a')].find((a) => a.textContent === 'the docs'))
  expect(t.calls.filter(([c]) => c === 'browser_open_external')).toEqual([['browser_open_external', { url: 'https://example.com/docs' }]])
})

test('inbox: the staged pages, one read, a drop confirmed and undone; the learned review one click away', async () => {
  await open()
  await tab('Inbox')
  const w = document.querySelector('[data-memory-window]')!
  expect(w.textContent).toContain('4 more staged for other projects')
  t.run['inbox --show'] = { stdout: '---\ntype: reference\n---\n\nRun the **whole** suite.', stderr: '', code: 0 }
  await click(button('Show', w.querySelector('[data-staged="reference/keep-the-suite-green"]')!))
  expect(w.querySelector('[data-shown]')!.textContent).toContain('Run the whole suite.')

  t.run['inbox --drop'] = { stdout: 'dropped reference/keep-the-suite-green', stderr: '', code: 0 }
  await click(button('Drop', w.querySelector('[data-staged]')!))
  await answer('Drop')
  expect(ran('inbox').map((a) => a.args)).toContainEqual(['--drop', 'reference/keep-the-suite-green'])
  await click(button('Undo', w))
  expect(ran('inbox').map((a) => a.args)).toContainEqual(['--restore', 'reference/keep-the-suite-green'])

  await click(button('What mnemo learned', w))
  expect(windowStore.getState().open?.id).toBe('learned')
})

test('a neighbour says how it stands to the centre', () => {
  expect(relation('a', 'b', [{ id: '1', source: 'b', target: 'a', kind: 'link', label: '' }])).toBe('links here')
  expect(relation('a', 'b', [])).toBe('nearby')
})
