// The cleanup view mounted on its own, driven the way a person would: what it lists, what it keeps
// and why, how a selection is confirmed or let go, and each guard between a click and a removed
// worktree. `removeWorktree` stands for the `worktree_remove` command; its refusals are the
// backend's own words (`src-tauri/src/worktree.rs`, whose guards its tests cover).
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { TooltipProvider } from '@/ui'
import { CleanupDialog } from './CleanupDialog'
import { archiveStore, openCleanup } from './archive'
import { agent, fleetStore, gitFacts, gitTree, layoutStore, refusals, removeWorktree, repo, resetFakes, toast, tree } from './testing'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./upstream', () => import('./testing'))

let root: Root | null = null
beforeEach(() => resetFakes())
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))
const click = (el: Element | null | undefined) => act(async () => (el as HTMLElement).click())
const byLabel = (label: string) => document.querySelector<HTMLElement>(`[aria-label="${label}"]`)
const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
const rows = () => [...document.querySelectorAll('[data-cleanup-row]')].map((r) => r.getAttribute('data-cleanup-row'))
const row = (path: string) => document.querySelector(`[data-cleanup-row="${path}"]`)!
const text = () => document.body.textContent ?? ''

/** The view, open and scanned. */
async function open() {
  root = createRoot(document.body.appendChild(document.createElement('div')))
  await act(async () => root!.render(<TooltipProvider>
        <CleanupDialog />
      </TooltipProvider>))
  await act(async () => openCleanup())
  await settle()
}

/** Two stale worktrees, one with a finished agent in it (which does not keep it), and the main
 *  checkout, whose merged PR does not make it one. */
function twoStale() {
  fleetStore.setState({
    repos: [
      repo('/r/app', [
        tree('/r/app', { kind: 'main', pr: { number: 1, state: 'merged', checks: null } }),
        tree('/r/app-wt-a', { agents: [agent('s1', 'done'), agent('s2', 'idle')] }),
        tree('/r/app-wt-b', { pr: { number: 2, state: 'closed', checks: null } }),
      ]),
    ],
  })
  gitFacts.set('/r/app', { base: 'origin/main', trees: [gitTree('/r/app-wt-a', { merged: true }), gitTree('/r/app-wt-b')] })
}

/** Selects the rows named `labels` and goes to the confirmation. */
async function confirm(...labels: string[]) {
  for (const l of labels) await click(byLabel(`Select ${l}`))
  await click(button('Delete selected'))
}

/** Puts an agent to work in `path` while the view is open. */
const agentStarts = (path: string) =>
  act(async () =>
    fleetStore.setState((f) => ({
      repos: f.repos.map((r) => ({ ...r, worktrees: r.worktrees.map((w) => (w.path === path ? { ...w, agents: [agent('late', 'working')] } : w)) })),
    })),
  )

describe('what the view lists', () => {
  test('only the stale worktrees; each other one is kept and counted under its first reason', async () => {
    const merged = { merged: true }
    fleetStore.setState({
      repos: [
        repo('/r/app', [
          tree('/r/app', { kind: 'main', pr: { number: 1, state: 'merged', checks: null } }),
          tree('/r/app-wt-clean'),
          tree('/r/app-wt-dirty'),
          // A child's PR merged, but a commit made since on a detached HEAD would go with the tree.
          tree('/r/app-wt-detached', { kind: 'dispatched', branch: null, pr: { number: 5, state: 'merged', checks: null } }),
          tree('/r/app-wt-working', { agents: [agent('w', 'working')] }),
          tree('/r/app-wt-asking', { agents: [agent('n', 'needs-you')] }),
          tree('/r/app-wt-setup'),
          tree('/r/app-wt-open', { pr: { number: 3, state: 'open', checks: null } }),
          tree('/r/app-wt-gone', { pr: { number: 4, state: 'merged', checks: null } }),
        ]),
      ],
    })
    gitFacts.set('/r/app', {
      base: 'origin/main',
      trees: [
        gitTree('/r/app-wt-clean', merged),
        gitTree('/r/app-wt-dirty', { ...merged, dirty: true }),
        gitTree('/r/app-wt-detached', { branch: null, merged: false, stranded: true }),
        gitTree('/r/app-wt-working', merged),
        gitTree('/r/app-wt-asking', merged),
        gitTree('/r/app-wt-setup', { ...merged, setupJob: 'worktree-setup:/r/app-wt-setup' }),
        gitTree('/r/app-wt-open'),
      ],
    })
    await open()
    expect(rows()).toEqual(['/r/app-wt-clean'])
    expect(text()).toContain(
      'Kept: 1 with changes · 1 with commits on no branch · 2 with an agent at work · 1 still setting up · 1 not merged · 1 git did not list.',
    )
    expect(text()).toContain('1 stale workspace')
    expect(removeWorktree.calls).toEqual([])
  })

  test('the main checkout is never asked about nor listed', async () => {
    fleetStore.setState({ repos: [repo('/r/solo', [tree('/r/solo', { kind: 'main', pr: { number: 1, state: 'merged', checks: null } })])] })
    gitFacts.set('/r/solo', { base: 'origin/main', trees: [gitTree('/r/solo', { isMain: true, merged: true })] })
    await open()
    expect(rows()).toEqual([])
    expect(text()).toContain('Nothing to clean up.')
  })

  test('a repo git cannot be asked about says so; its trees are not listed', async () => {
    twoStale()
    gitFacts.set('/r/app', 'fatal: not a git repository')
    await open()
    expect(rows()).toEqual([])
    expect(text()).toContain('app: fatal: not a git repository')
  })
})

describe('selecting and confirming', () => {
  test('nothing selected at first, and Delete selected does nothing until a row is', async () => {
    twoStale()
    await open()
    expect(rows()).toEqual(['/r/app-wt-a', '/r/app-wt-b'])
    expect(text()).toContain('0 selected')
    expect(button('Delete selected')!.disabled).toBe(true)
    await click(byLabel('Select app-wt-b'))
    expect(text()).toContain('1 selected')
    expect(byLabel('Select app-wt-b')!.getAttribute('aria-checked')).toBe('true')
    expect(byLabel('Select all')!.getAttribute('aria-checked')).toBe('mixed')
    await click(byLabel('Select all'))
    expect(text()).toContain('2 selected')
    await click(byLabel('Select all'))
    expect(text()).toContain('0 selected')
  })

  test('the confirmation names each one, says the folders go and the branches stay, and removes only on its own button', async () => {
    twoStale()
    await open()
    await confirm('app-wt-b')
    expect(text()).toContain('Delete workspaces: 1?')
    expect(text()).toContain('Their folders are deleted and their terminals closed. Their branches are kept.')
    const named = [...document.querySelectorAll('[role="group"]')]
    expect(named.map((g) => g.getAttribute('aria-label'))).toEqual(['app-wt-b'])
    expect(named[0].textContent).toContain('PR #2 closed')
    expect(named[0].textContent).toContain('/r/app-wt-b')
    expect(removeWorktree.calls).toEqual([])
  })

  test('Cancel, Back and closing the view remove nothing', async () => {
    twoStale()
    await open()
    await confirm('app-wt-a', 'app-wt-b')
    await click(button('Cancel'))
    expect(text()).toContain('2 selected')
    await click(button('Delete selected'))
    await click(byLabel('Back'))
    expect(text()).toContain('Clean up workspaces')
    // A row's own Remove confirms that one alone, the rest let go.
    await click(byLabel('Remove app-wt-a'))
    expect(text()).toContain('Delete workspaces: 1?')
    await click(button('Cancel'))
    expect(text()).toContain('1 selected')
    await click(byLabel('Close'))
    expect(archiveStore.getState().cleanup.open).toBe(false)
    expect(document.querySelector('[data-cleanup-dialog]')).toBeNull()
    expect(removeWorktree.calls).toEqual([])
    expect(layoutStore.getState().closeWorktree).not.toHaveBeenCalled()
  })

  test('with every guard passed, each is removed unforced, then its panes closed', async () => {
    twoStale()
    await open()
    await click(byLabel('Select all'))
    await click(button('Delete selected'))
    await click(button('Delete 2'))
    await settle()
    expect(removeWorktree.calls).toEqual([
      ['/r/app-wt-a', false],
      ['/r/app-wt-b', false],
    ])
    expect(layoutStore.getState().closeWorktree).toHaveBeenCalledTimes(2)
    expect(rows()).toEqual([])
    expect(toast.success).toHaveBeenCalledWith('Removed 2 workspaces', { description: 'Their branches are kept.' })
  })

  test('closed mid-batch, the batch goes on; it cannot be sent twice or cancelled halfway', async () => {
    twoStale()
    await open()
    let release!: () => void
    removeWorktree.impl = () => new Promise<void>((r) => (release = r))
    await confirm('app-wt-a')
    await click(button('Delete 1'))
    expect(text()).toContain('Deleting workspaces: 1')
    expect(text()).toContain('0/1 deleted')
    expect(button('Delete 1')).toBeUndefined()
    expect(byLabel('Back')!.hasAttribute('disabled')).toBe(true)
    await click(button('Close'))
    expect(archiveStore.getState().cleanup.open).toBe(false)
    await act(async () => release())
    await settle()
    expect(removeWorktree.calls).toEqual([['/r/app-wt-a', false]])
    expect(archiveStore.getState().removing.size).toBe(0)
  })
})

describe('each guard, when the tree changed after the scan', () => {
  /** Selects both and deletes them. */
  async function deleteBoth() {
    await click(byLabel('Select all'))
    await click(button('Delete selected'))
    await click(button('Delete 2'))
    await settle()
  }

  test('an agent at work now: not removed, and its row says why', async () => {
    twoStale()
    await open()
    await agentStarts('/r/app-wt-a')
    await deleteBoth()
    expect(removeWorktree.calls).toEqual([['/r/app-wt-b', false]])
    expect(rows()).toEqual(['/r/app-wt-a'])
    expect(row('/r/app-wt-a').querySelector('[role="alert"]')!.textContent).toBe('An agent is at work in it now.')
    expect(layoutStore.getState().closeWorktree).toHaveBeenCalledWith('/r/app-wt-b')
    expect(layoutStore.getState().closeWorktree).not.toHaveBeenCalledWith('/r/app-wt-a')
    expect(toast.error).toHaveBeenCalledWith('Removed 1 of 2 workspaces', { description: '1 could not be removed; each says why.' })
  })

  test.each([
    ['changes (git, never forced here)', "fatal: '/r/app-wt-a' contains modified or untracked files, use --force to delete it"],
    ['setup running', 'setup is still running in /r/app-wt-a'],
    ['a commit only its detached HEAD holds', '/r/app-wt-a is on no branch, at a commit no branch, remote or tag holds: removing it would lose that work. Make a branch there first'],
    ['the main checkout', 'the main checkout is not removed'],
    ['no longer a worktree', '/r/app-wt-a is not a worktree of /r/app'],
  ])('%s: the backend refuses it, its row says why, its panes stay open', async (_, why) => {
    twoStale()
    await open()
    refusals.set('/r/app-wt-a', why)
    await deleteBoth()
    expect(removeWorktree.calls).toEqual([
      ['/r/app-wt-a', false],
      ['/r/app-wt-b', false],
    ])
    expect(rows()).toEqual(['/r/app-wt-a'])
    expect(row('/r/app-wt-a').querySelector('[role="alert"]')!.textContent).toBe(why)
    // Still selected, so a second try needs no new pick, and still asks first.
    expect(text()).toContain('1 selected')
    expect(layoutStore.getState().closeWorktree).not.toHaveBeenCalledWith('/r/app-wt-a')
  })

  test('a rescan moves a tree that stopped being stale out of the list and the selection', async () => {
    twoStale()
    await open()
    await click(byLabel('Select all'))
    gitFacts.set('/r/app', { base: 'origin/main', trees: [gitTree('/r/app-wt-a', { merged: true, dirty: true }), gitTree('/r/app-wt-b')] })
    await click(byLabel('Refresh'))
    await settle()
    expect(rows()).toEqual(['/r/app-wt-b'])
    expect(text()).toContain('1 selected')
    expect(text()).toContain('Kept: 1 with changes.')
  })
})
