// The cleanup view and a card's "Remove workspace?" against the live archive store (a selector
// that built a new object each read would re-render forever here, #212). Menus and tooltips are
// popper content, never opened in jsdom; what they run is tested in archive.test.ts.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { TooltipProvider } from '@/ui'
import ArchiveOverlay from './ArchiveOverlay'
import LeftSidebar from './Sidebar'
import { archiveStore, openCleanup, requestRemove } from './archive'
import { fleetStore, gitFacts, gitTree, layoutStore, removeWorktree, repo, resetFakes, tree } from './testing'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./upstream', () => import('./testing'))

let root: Root | null = null
async function mount(node: React.ReactNode): Promise<HTMLElement> {
  const host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  // The shell draws its overlay slot inside a TooltipProvider.
  await act(async () => root!.render(<TooltipProvider>{node}</TooltipProvider>))
  return host
}
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

function fleet() {
  fleetStore.setState({
    repos: [
      repo('/r/app', [
        tree('/r/app', { kind: 'main' }),
        tree('/r/app-wt-child', { kind: 'dispatched', branch: 'dispatch/9', pr: { number: 9, state: 'merged', checks: null } }),
        tree('/r/app-wt-old', { branch: 'old' }),
        tree('/r/app-wt-wip', { branch: 'wip' }),
      ]),
    ],
  })
  gitFacts.set('/r/app', {
    base: 'origin/main',
    trees: [gitTree('/r/app-wt-child'), gitTree('/r/app-wt-old', { merged: true }), gitTree('/r/app-wt-wip', { dirty: true, merged: true })],
  })
}

test('the cleanup view lists the stale worktrees, why each is stale, and why the rest stay', async () => {
  fleet()
  await mount(<ArchiveOverlay />)
  expect(document.querySelector('[data-cleanup-dialog]')).toBeNull()
  await act(async () => openCleanup())
  await settle()
  const dialog = document.querySelector('[data-cleanup-dialog]')!
  expect(dialog.textContent).toContain('Clean up workspaces')
  const rows = [...dialog.querySelectorAll('[data-cleanup-row]')]
  expect(rows.map((r) => r.getAttribute('data-cleanup-row'))).toEqual(['/r/app-wt-child', '/r/app-wt-old'])
  expect(rows[0].textContent).toContain('PR #9 merged')
  expect(rows[0].textContent).toContain('dispatched')
  expect(rows[0].textContent).toContain('dispatch/9')
  expect(rows[1].textContent).toContain('In origin/main')
  expect(dialog.textContent).toContain('Kept: 1 with changes.')
  expect(dialog.textContent).toContain('0 selected')
  expect(button('Delete selected')!.disabled).toBe(true)
})

test('select, confirm, and delete in one go; the view comes back without them', async () => {
  fleet()
  await mount(<ArchiveOverlay />)
  await act(async () => openCleanup())
  await settle()
  await click(byLabel('Select all'))
  expect(byLabel('Select all')!.getAttribute('aria-checked')).toBe('true')
  await click(byLabel('Select app-wt-child'))
  expect(byLabel('Select all')!.getAttribute('aria-checked')).toBe('mixed')
  expect(document.body.textContent).toContain('1 selected')
  await click(byLabel('Select app-wt-child'))
  await click(button('Delete selected'))
  expect(document.body.textContent).toContain('Delete workspaces: 2?')
  expect(document.body.textContent).toContain('Their branches are kept.')
  expect([...document.querySelectorAll('[role="group"]')].map((g) => g.getAttribute('aria-label'))).toEqual(['app-wt-child', 'app-wt-old'])
  // Back leaves the selection as it was.
  await click(button('Cancel'))
  expect(document.body.textContent).toContain('2 selected')
  await click(button('Delete selected'))
  await click(button('Delete 2'))
  await settle()
  expect(removeWorktree.calls).toEqual([
    ['/r/app-wt-child', false],
    ['/r/app-wt-old', false],
  ])
  expect(document.querySelectorAll('[data-cleanup-row]')).toHaveLength(0)
  expect(document.body.textContent).toContain('Nothing to clean up.')
})

test('a row’s own Remove confirms just that one; Open shows it and closes the view', async () => {
  fleet()
  await mount(<ArchiveOverlay />)
  await act(async () => openCleanup())
  await settle()
  await click(byLabel('Remove app-wt-old'))
  expect(document.body.textContent).toContain('Delete workspaces: 1?')
  await click(byLabel('Back'))
  await click(byLabel('Open app-wt-child'))
  expect(layoutStore.getState().switchWorktree).toHaveBeenCalledWith('/r/app-wt-child')
  expect(archiveStore.getState().cleanup.open).toBe(false)
})

test('Remove workspace on a tree with changes asks first, saying what is lost and what is kept', async () => {
  fleet()
  await mount(<ArchiveOverlay />)
  await act(() => requestRemove(fleetStore.getState().repos[0].worktrees[3]))
  const dialog = document.querySelector('[data-remove-dialog]')!
  expect(dialog.textContent).toContain('Remove app-wt-wip?')
  expect(dialog.textContent).toContain('uncommitted changes')
  expect(dialog.textContent).toContain('Branch wip is kept.')
  await click(button('Remove'))
  await settle()
  expect(removeWorktree.calls).toEqual([['/r/app-wt-wip', true]])
  expect(document.querySelector('[data-remove-dialog]')).toBeNull()
})

test('a card being removed says so and takes no clicks; the header opens the cleanup view', async () => {
  fleet()
  const host = await mount(<LeftSidebar />)
  const surface = () => host.querySelector('[data-worktree-path="/r/app-wt-old"] [data-worktree-card-surface]')!
  expect(surface().getAttribute('aria-busy')).toBe('false')
  await act(async () => archiveStore.setState({ removing: new Set(['/r/app-wt-old']) }))
  expect(surface().getAttribute('aria-busy')).toBe('true')
  expect(surface().textContent).toContain('Removing…')
  await click(surface())
  expect(layoutStore.getState().switchWorktree).not.toHaveBeenCalled()

  await click(host.querySelector('[aria-label="Clean up workspaces"]'))
  expect(archiveStore.getState().cleanup.open).toBe(true)
})

test('the repo header’s … does not fold the repo', async () => {
  fleet()
  const host = await mount(<LeftSidebar />)
  const more = host.querySelector<HTMLElement>('[aria-label="app actions"]')!
  expect(more).not.toBeNull()
  await click(more)
  expect(host.querySelector('[data-repo-header]')!.getAttribute('aria-expanded')).toBe('true')
})
