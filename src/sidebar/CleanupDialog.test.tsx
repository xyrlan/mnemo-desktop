// The cleanup view mounted on its own, down to the Tauri commands: the worktrees client is the
// real one and `invoke` is a recorder, so each test sees exactly what reaches `worktree.rs`
// (`worktree_cleanup_facts`, `worktree_remove`). Every guard keeps a tree off the list, and keeps
// it when it trips between the scan and the delete. Tooltips are popper content, never opened.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { TooltipProvider } from '@/ui'
import type { CleanupFacts } from '../worktrees/client'
import { CleanupDialog } from './CleanupDialog'
import { archiveStore, openCleanup } from './archive'
import { agent, fleetStore, gitTree, layoutStore, repo, resetFakes, toast, tree } from './testing'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Every command the view sent, in order. A plain recorder: a vi.fn() rejecting with a string
 *  (as Tauri rejects) fails the test under vitest 5. */
const calls: Array<[string, Record<string, unknown>]> = []
/** What `worktree_cleanup_facts` answers, by repo; a string is its refusal. */
let facts: Record<string, CleanupFacts | string> = {}
/** Why `worktree_remove` refuses a path, as git says it. */
const refusals = new Map<string, string>()
async function ipc(cmd: string, args: Record<string, unknown>): Promise<unknown> {
  calls.push([cmd, args])
  if (cmd === 'worktree_cleanup_facts') {
    const f = facts[args.repo as string]
    if (typeof f === 'string') throw f
    return structuredClone(f ?? { base: 'origin/main', trees: [] })
  }
  if (cmd === 'worktree_remove') {
    const why = refusals.get(args.path as string)
    if (why) throw why
    return null
  }
  throw new Error(`unexpected command ${cmd}`)
}
vi.mock('@tauri-apps/api/core', () => ({ invoke: (cmd: string, args: Record<string, unknown>) => ipc(cmd, args) }))
vi.mock('./upstream', async () => ({ ...(await import('./testing')), ...(await import('../worktrees/client')) }))

const sent = (cmd: string) => calls.filter(([c]) => c === cmd).map(([, a]) => a)
const removed = () => sent('worktree_remove')

let root: Root | null = null
async function mount() {
  const host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await act(async () =>
    root!.render(
      <TooltipProvider>
        <CleanupDialog />
      </TooltipProvider>,
    ),
  )
}
beforeEach(() => {
  resetFakes()
  calls.length = 0
  facts = {}
  refusals.clear()
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))
const click = async (el: Element | null | undefined) => {
  expect(el).toBeTruthy()
  await act(async () => (el as HTMLElement).click())
  await settle()
}
const byLabel = (label: string) => document.querySelector<HTMLElement>(`[aria-label="${label}"]`)
const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
const rows = () => [...document.querySelectorAll('[data-cleanup-row]')].map((r) => r.getAttribute('data-cleanup-row'))
const rowText = (path: string) => document.querySelector(`[data-cleanup-row="${path}"]`)?.textContent ?? ''
const dialog = () => document.querySelector('[data-cleanup-dialog]')

/** Two repos: `/r/app` with two stale trees, `/r/web` with one; each main checkout beside them. */
function stale() {
  fleetStore.setState({
    repos: [
      repo('/r/app', [tree('/r/app', { kind: 'main' }), tree('/r/app-wt-done'), tree('/r/app-wt-shipped', { pr: { number: 7, state: 'merged', checks: null } })]),
      repo('/r/web', [tree('/r/web', { kind: 'main' }), tree('/r/web-wt-old')]),
    ],
  })
  facts = {
    '/r/app': { base: 'origin/main', trees: [gitTree('/r/app-wt-done', { merged: true }), gitTree('/r/app-wt-shipped')] },
    '/r/web': { base: 'origin/main', trees: [gitTree('/r/web-wt-old', { merged: true })] },
  }
}

async function open() {
  await mount()
  await act(async () => openCleanup())
  await settle()
}

/** Select `names` and reach the confirmation. */
async function confirm(...names: string[]) {
  for (const n of names) await click(byLabel(`Select ${n}`))
  await click(button('Delete selected'))
}

describe('what counts as stale', () => {
  test('a merged tree or one whose PR ended is listed; each guard keeps one off the list and says so', async () => {
    const merged = { merged: true }
    fleetStore.setState({
      repos: [
        repo('/r/app', [
          tree('/r/app', { kind: 'main' }),
          tree('/r/app-wt-done'),
          tree('/r/app-wt-pr', { pr: { number: 4, state: 'closed', checks: null } }),
          tree('/r/app-wt-dirty'),
          tree('/r/app-wt-agent', { agents: [agent('s1', 'working')] }),
          tree('/r/app-wt-asks', { agents: [agent('s2', 'needs-you')] }),
          tree('/r/app-wt-idle', { agents: [agent('s3', 'idle')] }),
          tree('/r/app-wt-busy'),
          tree('/r/app-wt-setup'),
          tree('/r/app-wt-later', { pr: { number: 5, state: 'merged', checks: null } }),
          tree('/r/app-wt-open'),
          tree('/r/app-wt-ghost'),
        ]),
      ],
    })
    facts = {
      '/r/app': {
        base: 'origin/main',
        trees: [
          // The backend leaves the main checkout out; even if it did not, the view never lists it.
          gitTree('/r/app', { isMain: true, ...merged }),
          gitTree('/r/app-wt-done', merged),
          gitTree('/r/app-wt-pr'),
          gitTree('/r/app-wt-dirty', { ...merged, dirty: true }),
          gitTree('/r/app-wt-agent', merged),
          gitTree('/r/app-wt-asks', merged),
          gitTree('/r/app-wt-idle', merged),
          gitTree('/r/app-wt-busy', { ...merged, programs: ['node (4123)'] }),
          gitTree('/r/app-wt-setup', { ...merged, setupJob: 'worktree-setup:/r/app-wt-setup' }),
          gitTree('/r/app-wt-later', { unpushed: true }),
          gitTree('/r/app-wt-open', { unpushed: true }),
        ],
      },
    }
    // Two terminals of this window, and a browser pane, whose negative id is no terminal.
    layoutStore.setState({ panes: { 3: { id: 3, view: 'terminal' }, 8: { id: 8, view: 'terminal' }, [-2]: { id: -2, view: 'browser' } } })
    await open()
    expect(sent('worktree_cleanup_facts')).toEqual([{ repo: '/r/app', panes: [3, 8] }])
    expect(rows()).toEqual(['/r/app-wt-done', '/r/app-wt-pr', '/r/app-wt-idle'])
    expect(rowText('/r/app-wt-done')).toContain('In origin/main')
    expect(rowText('/r/app-wt-pr')).toContain('PR #4 closed')
    expect(dialog()!.textContent).toContain(
      'Kept: 1 with changes · 2 with an agent at work · 1 with a program running in it · 1 still setting up · 1 with unpushed commits · 1 not merged · 1 git did not list.',
    )
    expect(dialog()!.textContent).toContain('3 stale workspaces')
    expect(removed()).toEqual([])
  })

  test('a repo git cannot be asked about lists nothing of it and says why', async () => {
    stale()
    facts['/r/web'] = 'fatal: not a git repository'
    await open()
    expect(rows()).toEqual(['/r/app-wt-done', '/r/app-wt-shipped'])
    expect(dialog()!.textContent).toContain('web: fatal: not a git repository')
  })

  test('with nothing stale it says so and offers nothing to delete', async () => {
    fleetStore.setState({ repos: [repo('/r/app', [tree('/r/app', { kind: 'main' })])] })
    await open()
    // A repo with only its main checkout is not even asked.
    expect(calls).toEqual([])
    expect(dialog()!.textContent).toContain('Nothing to clean up.')
    expect(button('Delete selected')!.disabled).toBe(true)
  })
})

describe('selection, confirmation and cancel', () => {
  test('nothing is selected at first; rows and Select all toggle it', async () => {
    stale()
    await open()
    expect(dialog()!.textContent).toContain('0 selected')
    expect(button('Delete selected')!.disabled).toBe(true)
    await click(byLabel('Select app-wt-done'))
    expect(byLabel('Select app-wt-done')!.getAttribute('aria-checked')).toBe('true')
    expect(byLabel('Select all')!.getAttribute('aria-checked')).toBe('mixed')
    await click(byLabel('Select all'))
    expect(dialog()!.textContent).toContain('3 selected')
    await click(byLabel('Select all'))
    expect(dialog()!.textContent).toContain('0 selected')
  })

  test('the confirmation names each tree and what is kept; Cancel and Back remove nothing and keep the selection', async () => {
    stale()
    await open()
    await confirm('app-wt-done', 'web-wt-old')
    expect(dialog()!.textContent).toContain('Delete workspaces: 2?')
    expect(dialog()!.textContent).toContain('files git ignores included')
    expect(dialog()!.textContent).toContain('Their branches are kept.')
    expect([...document.querySelectorAll('[role="group"]')].map((g) => g.textContent)).toEqual([
      expect.stringContaining('/r/app-wt-done'),
      expect.stringContaining('/r/web-wt-old'),
    ])
    await click(button('Cancel'))
    expect(dialog()!.textContent).toContain('2 selected')
    await click(button('Delete selected'))
    await click(byLabel('Back'))
    expect(dialog()!.textContent).toContain('2 selected')
    expect(removed()).toEqual([])
  })

  test('closing the view removes nothing', async () => {
    stale()
    await open()
    await confirm('app-wt-done')
    await click(button('Cancel'))
    await click(byLabel('Close'))
    expect(dialog()).toBeNull()
    expect(archiveStore.getState().cleanup.open).toBe(false)
    expect(removed()).toEqual([])
  })

  test('a row’s own Remove confirms just that one', async () => {
    stale()
    await open()
    await click(byLabel('Select app-wt-done'))
    await click(byLabel('Remove web-wt-old'))
    expect(dialog()!.textContent).toContain('Delete workspaces: 1?')
    expect([...document.querySelectorAll('[role="group"]')].map((g) => g.getAttribute('aria-label'))).toEqual(['web-wt-old'])
    await click(button('Delete 1'))
    expect(removed()).toEqual([{ path: '/r/web-wt-old', force: false }])
  })
})

describe('deleting', () => {
  test('each tree is checked again, then removed unforced, one at a time; its panes close; the list drops it', async () => {
    stale()
    await open()
    calls.length = 0
    await confirm('app-wt-done', 'app-wt-shipped', 'web-wt-old')
    await click(button('Delete 3'))
    // Facts read afresh, once per repo, before anything is removed.
    expect(calls.map(([c, a]) => `${c} ${a.repo ?? a.path}`)).toEqual([
      'worktree_cleanup_facts /r/app',
      'worktree_cleanup_facts /r/web',
      'worktree_remove /r/app-wt-done',
      'worktree_remove /r/app-wt-shipped',
      'worktree_remove /r/web-wt-old',
    ])
    expect(removed().every((a) => a.force === false)).toBe(true)
    expect(layoutStore.getState().closeWorktree).toHaveBeenCalledTimes(3)
    expect(rows()).toEqual([])
    expect(dialog()!.textContent).toContain('Nothing to clean up.')
    expect(toast.success).toHaveBeenCalledWith('Removed 3 workspaces', { description: 'Their branches are kept.' })
  })

  test('git refusing one keeps it listed, saying why; the rest go', async () => {
    stale()
    await open()
    refusals.set('/r/app-wt-done', "fatal: '/r/app-wt-done' contains modified or untracked files, use --force to delete it")
    await confirm('app-wt-done', 'web-wt-old')
    await click(button('Delete 2'))
    expect(removed().map((a) => a.path)).toEqual(['/r/app-wt-done', '/r/web-wt-old'])
    expect(rows()).toEqual(['/r/app-wt-done', '/r/app-wt-shipped'])
    expect(rowText('/r/app-wt-done')).toContain('contains modified or untracked files')
    expect(layoutStore.getState().closeWorktree).toHaveBeenCalledWith('/r/web-wt-old')
    expect(layoutStore.getState().closeWorktree).not.toHaveBeenCalledWith('/r/app-wt-done')
    expect(toast.error).toHaveBeenCalledWith('Removed 1 of 2 workspaces', { description: '1 could not be removed; each says why.' })
  })

  // What changed between the scan and the click, and what the row then says.
  const changes: Array<[string, string, () => void, string]> = [
    ['it got changes', 'app-wt-done', () => ((facts['/r/app'] as CleanupFacts).trees[0].dirty = true), 'Kept: it has uncommitted changes.'],
    [
      'an agent started in it',
      'app-wt-done',
      () =>
        fleetStore.setState({
          refresh: vi.fn(async () => {
            const [app, web] = fleetStore.getState().repos
            const worktrees = app.worktrees.map((w) => (w.path === '/r/app-wt-done' ? { ...w, agents: [agent('s9', 'working')] } : w))
            fleetStore.setState({ repos: [{ ...app, worktrees }, web] })
          }),
        }),
      'Kept: an agent is at work in it.',
    ],
    ['a program started in it', 'app-wt-done', () => ((facts['/r/app'] as CleanupFacts).trees[0].programs = ['zsh (812)', 'node (813)']), 'Kept: zsh (812), node (813) run in it.'],
    ['its setup started', 'app-wt-done', () => ((facts['/r/app'] as CleanupFacts).trees[0].setupJob = 'worktree-setup:/r/app-wt-done'), 'Kept: its setup is still running.'],
    [
      'it got commits no remote has',
      'app-wt-shipped',
      () => Object.assign((facts['/r/app'] as CleanupFacts).trees[1], { unpushed: true }),
      'Kept: it has commits no remote has.',
    ],
    ['it is no longer merged', 'app-wt-done', () => ((facts['/r/app'] as CleanupFacts).trees[0].merged = false), 'Kept: it is not merged.'],
    ['git stopped listing it', 'app-wt-done', () => (facts['/r/app'] as CleanupFacts).trees.splice(0, 1), 'Kept: git does not list it.'],
    ['its repo cannot be read', 'app-wt-done', () => (facts['/r/app'] = 'fatal: unable to read tree'), 'Kept: it could not be checked again: fatal: unable to read tree'],
  ]
  test.each(changes)('a tree is kept, saying why, when since the scan %s; the others go', async (_, name, change, why) => {
    stale()
    await open()
    const path = `/r/${name}`
    change()
    await confirm(name, 'web-wt-old')
    await click(button('Delete 2'))
    expect(removed()).toEqual([{ path: '/r/web-wt-old', force: false }])
    expect(rows()).toContain(path)
    expect(rowText(path)).toContain(why)
    expect(byLabel(`Select ${name}`)!.getAttribute('aria-checked')).toBe('true')
    expect(layoutStore.getState().closeWorktree).not.toHaveBeenCalledWith(path)
  })

  test('a tree the fleet no longer shows, or shows as a main checkout, is kept', async () => {
    stale()
    await open()
    const [app, web] = fleetStore.getState().repos
    fleetStore.setState({
      repos: [{ ...app, worktrees: app.worktrees.filter((w) => w.path !== '/r/app-wt-done') }, { ...web, worktrees: web.worktrees.map((w) => ({ ...w, kind: 'main' as const })) }],
    })
    await confirm('app-wt-done', 'web-wt-old')
    await click(button('Delete 2'))
    expect(removed()).toEqual([])
    expect(rowText('/r/app-wt-done')).toContain('Kept: the fleet no longer lists it.')
    expect(rowText('/r/web-wt-old')).toContain('Kept: the fleet no longer lists it.')
  })
})
