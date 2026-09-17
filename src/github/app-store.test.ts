import { selectionStore } from './app-store'

beforeEach(() => selectionStore.getState().clearSelection())

const nomod = { shift: false, meta: false }
const order = [1, 2, 3, 4, 5]

test('a plain pick selects just that issue', () => {
  selectionStore.getState().pick('/repo', order, 3, nomod)
  expect(selectionStore.getState()).toMatchObject({ root: '/repo', ns: [3] })
})

test('a shift pick extends the range from the last pick, either direction', () => {
  const s = selectionStore.getState()
  s.pick('/repo', order, 2, nomod)
  s.pick('/repo', order, 4, { shift: true, meta: false })
  expect(selectionStore.getState().ns).toEqual([2, 3, 4])
  s.pick('/repo', order, 1, nomod)
  s.pick('/repo', order, 4, { shift: true, meta: false })
  expect(selectionStore.getState().ns).toEqual([1, 2, 3, 4])
})

test('a meta pick toggles membership without disturbing the rest', () => {
  const s = selectionStore.getState()
  const meta = { shift: false, meta: true }
  s.pick('/repo', order, 1, nomod)
  s.pick('/repo', order, 3, meta)
  expect(selectionStore.getState().ns).toEqual([1, 3])
  s.pick('/repo', order, 1, meta)
  expect(selectionStore.getState().ns).toEqual([3])
})

test('switching repos drops the old selection', () => {
  const s = selectionStore.getState()
  s.pick('/repo-a', order, 1, nomod)
  s.pick('/repo-b', order, 2, nomod)
  expect(selectionStore.getState()).toMatchObject({ root: '/repo-b', ns: [2] })
})

test('a shift pick with no prior selection, or outside the known order, falls back to a plain pick', () => {
  const s = selectionStore.getState()
  const shift = { shift: true, meta: false }
  s.pick('/repo', order, 3, shift)
  expect(selectionStore.getState().ns).toEqual([3])
  s.pick('/repo', order, 1, nomod)
  s.pick('/repo', [], 4, shift)
  expect(selectionStore.getState().ns).toEqual([4])
})

test('clearSelection empties the pick and forgets the repo', () => {
  selectionStore.getState().pick('/repo', order, 1, nomod)
  selectionStore.getState().clearSelection()
  expect(selectionStore.getState()).toMatchObject({ root: null, ns: [] })
})
