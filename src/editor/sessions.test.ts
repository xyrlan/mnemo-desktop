import { createSessions } from './sessions'

test('open is idempotent so a remounted pane keeps its state', () => {
  const s = createSessions()
  s.getState().open(-1, '/a.ts', '/w')
  s.getState().toggleTree(-1)
  s.getState().open(-1, '/b.ts', '/other')
  expect(s.getState().sessions[-1]).toMatchObject({ path: '/a.ts', root: '/w', treeOpen: false })
})

test('navigate replaces a clean buffer, parks the path while dirty', () => {
  const s = createSessions()
  const st = () => s.getState()
  st().open(-1, '/a.ts', '/w')
  st().setError(-1, 'old error')
  st().navigate(-1, '/b.ts')
  expect(st().sessions[-1]).toMatchObject({ path: '/b.ts', error: undefined })

  st().setDirty(-1, true)
  st().navigate(-1, '/c.ts')
  expect(st().sessions[-1]).toMatchObject({ path: '/b.ts', pending: '/c.ts', dirty: true })
  st().cancelPending(-1)
  expect(st().sessions[-1].pending).toBeUndefined()

  st().navigate(-1, '/c.ts')
  st().discard(-1)
  expect(st().sessions[-1]).toMatchObject({ path: '/c.ts', pending: undefined, dirty: false })
})

test('navigating to the open file is a no-op that clears pending', () => {
  const s = createSessions()
  s.getState().open(-1, '/a.ts', '/w')
  s.getState().setDirty(-1, true)
  s.getState().navigate(-1, '/b.ts')
  s.getState().navigate(-1, '/a.ts')
  expect(s.getState().sessions[-1]).toMatchObject({ path: '/a.ts', pending: undefined, dirty: true })
})

test('toggleDir expands and collapses', () => {
  const s = createSessions()
  s.getState().open(-1, '/w/a.ts', '/w')
  s.getState().toggleDir(-1, '/w/src')
  s.getState().toggleDir(-1, '/w/lib')
  s.getState().toggleDir(-1, '/w/src')
  expect(s.getState().sessions[-1].expanded).toEqual(['/w/lib'])
})

test('prune forgets closed panes and disposes their buffers', () => {
  const s = createSessions()
  const disposed: number[] = []
  for (const id of [-1, -2]) {
    s.getState().open(id, `/f${id}`, '/w')
    s.buffers.set(id, { path: `/f${id}`, savedVersion: 1, model: { dispose: () => disposed.push(id) } })
  }
  s.getState().prune([-2, 5])
  expect(Object.keys(s.getState().sessions)).toEqual(['-2'])
  expect([...s.buffers.keys()]).toEqual([-2])
  expect(disposed).toEqual([-1])
})

test('actions on unknown panes do nothing', () => {
  const s = createSessions()
  s.getState().toggleTree(-9)
  s.getState().navigate(-9, '/x')
  s.getState().setDirty(-9, true)
  expect(s.getState().sessions).toEqual({})
})
