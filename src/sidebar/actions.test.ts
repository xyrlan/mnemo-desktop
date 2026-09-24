import { activateAgent, addProject, registerSidebarActions } from './actions'
import { archiveStore } from './archive'
import { sidebarStore } from './store'
import { actions, fleetStore, homeStore, layoutStore, repo, resetFakes, tree } from './testing'

vi.mock('./upstream', () => import('./testing'))

beforeAll(() => registerSidebarActions())
beforeEach(() => resetFakes())

const three = () =>
  fleetStore.setState({
    repos: [repo('/r/a', [tree('/r/a', { kind: 'main' }), tree('/r/a-wt-fix')]), repo('/r/b', [tree('/r/b', { kind: 'main' })])],
  })

test('worktree.go.1 … worktree.go.9 are registered, with the keymap’s chords', () => {
  const ids = [...actions.keys()].filter((id) => id.startsWith('worktree.go.'))
  expect(ids).toEqual(Array.from({ length: 9 }, (_, i) => `worktree.go.${i + 1}`))
  expect(actions.get('worktree.go.1')).toMatchObject({ title: 'Go to workspace 1', shortcut: '⌘1' })
  expect(actions.get('worktree.go.9')?.shortcut).toBe('⌘9')
})

test('worktree.cleanup opens the cleanup view', async () => {
  expect(actions.get('worktree.cleanup')).toMatchObject({ title: 'Clean up workspaces…' })
  await actions.get('worktree.cleanup')!.run()
  expect(archiveStore.getState().cleanup.open).toBe(true)
})

test('worktree.go.N shows the Nth card in sidebar order and marks it read', async () => {
  three()
  await actions.get('worktree.go.2')!.run()
  expect(layoutStore.getState().switchWorktree).toHaveBeenCalledWith('/r/a-wt-fix')
  expect(fleetStore.getState().markRead).toHaveBeenCalledWith('/r/a-wt-fix')
  await actions.get('worktree.go.3')!.run()
  expect(layoutStore.getState().switchWorktree).toHaveBeenLastCalledWith('/r/b')
})

test('a folded repo’s cards are not counted', async () => {
  three()
  sidebarStore.getState().toggleRepo('/r/a')
  await actions.get('worktree.go.1')!.run()
  expect(layoutStore.getState().switchWorktree).toHaveBeenCalledWith('/r/b')
})

test('past the last card, worktree.go.N does nothing', async () => {
  three()
  await actions.get('worktree.go.4')!.run()
  expect(layoutStore.getState().switchWorktree).not.toHaveBeenCalled()
  expect(fleetStore.getState().markRead).not.toHaveBeenCalled()
})

test('an agent with a pane is shown in its pane; one without, by its worktree', () => {
  activateAgent('/r/a-wt-fix', 12)
  expect(layoutStore.getState().goToPane).toHaveBeenCalledWith(12)
  expect(layoutStore.getState().switchWorktree).not.toHaveBeenCalled()
  expect(fleetStore.getState().markRead).toHaveBeenCalledWith('/r/a-wt-fix')

  activateAgent('/r/a-wt-child', null)
  expect(layoutStore.getState().switchWorktree).toHaveBeenCalledWith('/r/a-wt-child')
  expect(fleetStore.getState().markRead).toHaveBeenLastCalledWith('/r/a-wt-child')
})

test('adding a project reports the error Home noted for this pick, and only that', async () => {
  expect(await addProject()).toBeNull()
  expect(homeStore.getState().openFolder).toHaveBeenCalledTimes(1)

  homeStore.setState({ openFolder: vi.fn(async () => homeStore.setState({ notice: 'não é um repositório git' })) })
  expect(await addProject()).toBe('não é um repositório git')
  expect(homeStore.getState().dismiss).toHaveBeenCalledTimes(1)

  // An older notice Home already showed is not this pick's.
  homeStore.setState({ notice: 'snapshot failed', openFolder: vi.fn(async () => {}), dismiss: vi.fn() })
  expect(await addProject()).toBeNull()
  expect(homeStore.getState().dismiss).not.toHaveBeenCalled()
})
