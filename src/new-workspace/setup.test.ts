import { createSetupStore, KEEP_LINES, shownRuns } from './setup'

const ID = 'worktree-setup:/gh/app-wt-a'

test('a run is heard before it is tracked, and tracking shows what was heard', () => {
  const s = createSetupStore()
  s.getState().line(ID, 'installing')
  s.getState().exit(ID, 0)
  expect(shownRuns(s.getState())).toEqual([])
  s.getState().track(ID, { path: '/gh/app-wt-a', name: 'a' })
  expect(shownRuns(s.getState())).toEqual([{ id: ID, path: '/gh/app-wt-a', name: 'a', state: 'done', code: 0, lines: ['installing'], tracked: true }])
})

test('events of other jobs are ignored', () => {
  const s = createSetupStore()
  s.getState().line('dispatch:/gh/app#1', 'x')
  s.getState().exit('dispatch:/gh/app#1', 1)
  expect(s.getState().runs).toEqual({})
})

test('a non-zero or unknown exit fails the run', () => {
  const s = createSetupStore()
  s.getState().track(ID, { path: '/gh/app-wt-a', name: 'a' })
  expect(s.getState().runs[ID].state).toBe('running')
  s.getState().exit(ID, 2)
  expect(s.getState().runs[ID]).toMatchObject({ state: 'failed', code: 2 })
  s.getState().line(ID, 'again')
  s.getState().exit(ID, null)
  expect(s.getState().runs[ID]).toMatchObject({ state: 'failed', code: null })
})

test('a line after the run ended starts a new run of the same tree, keeping its name', () => {
  const s = createSetupStore()
  s.getState().track(ID, { path: '/gh/app-wt-a', name: 'a' })
  s.getState().line(ID, 'old')
  s.getState().exit(ID, 1)
  s.getState().line(ID, 'new')
  expect(s.getState().runs[ID]).toMatchObject({ state: 'running', code: null, lines: ['new'], name: 'a', path: '/gh/app-wt-a', tracked: false })
})

test('only the last lines are kept', () => {
  const s = createSetupStore()
  for (let i = 0; i < KEEP_LINES + 5; i++) s.getState().line(ID, `l${i}`)
  const lines = s.getState().runs[ID].lines
  expect(lines).toHaveLength(KEEP_LINES)
  expect(lines[lines.length - 1]).toBe(`l${KEEP_LINES + 4}`)
})

test('dismiss forgets the run', () => {
  const s = createSetupStore()
  s.getState().track(ID, { path: '/p', name: 'a' })
  s.getState().dismiss(ID)
  expect(s.getState().runs).toEqual({})
})
